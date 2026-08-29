import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { bindReturnCookieName, clearBindReturnCookie, clearExternalStateCookie, consumeExternalState, createExternalState, createPendingExternalIdentity, discardExternalEmailOtp, externalAuthorizationUrl, externalPendingCookie, externalProvider, externalQrState, externalStateCookie, externalIdentityUser, externalStateCookieName, externalVerifiedCookie, fetchExternalProfile, issueExternalEmailOtp, pendingExternalIdentityByQrState, resolveExternalUser, verifyExternalEmailOtp, type ExternalProviderId } from '@server/accounts/external.mjs';
import { readCookie } from '@server/accounts/oidc.mjs';
import { postLoginRedirect } from '@server/accounts/onboarding.mjs';
import { externalAvatarUrl, syncExternalAvatar } from '@server/passport/avatar.mjs';
import { createPassportSessionCookie, ensurePassportDevice, loadPassportSession } from '@server/passport/session.mjs';
import { runSql, sql } from '@server/database/sql.mjs';
import { isSecureRequest, requestOrigin } from '@server/request-origin.mjs';
import { sha256 } from '@server/accounts/oidc.mjs';
import { sendDefaultCloudEmail } from '@server/cloud/email.mjs';

const providerId = (value: string): ExternalProviderId | undefined => value === 'google' || value === 'wechat' ? value : undefined;

const handler: ApiHandler = async (c, _next, params) => {
	if (!['GET', 'POST'].includes(c.req.method)) return apiMessage(c, 404);
	const database = c.get('passportDatabase'), id = providerId(params.id);
	if (!database) return apiMessage(c, 503, 'Accounts 数据库不可用');
	if (!id) return apiMessage(c, 404, '外部身份源不存在');
	const provider = await externalProvider(database, id);
	if (!provider) return apiMessage(c, 404, `${id === 'google' ? 'Google' : '微信'}登录尚未启用`);
	const secure = isSecureRequest(c);
	const bindState = c.req.query('bind')?.trim();
	if (c.req.method === 'POST' && bindState) {
		const pending = await pendingExternalIdentityByQrState(database, bindState);
		if (!pending || pending.provider !== id) return apiMessage(c, 410, '邮箱绑定状态不存在或已过期，请重新扫码');
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({})) as Record<string, unknown>;
		const step = String(body.step ?? 'email');
		if (step === 'email') {
			let issued: Awaited<ReturnType<typeof issueExternalEmailOtp>>;
			try { issued = await issueExternalEmailOtp(database, pending, String(body.email ?? '')); }
			catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '邮箱不合法'); }
			try { await sendDefaultCloudEmail(c.get('globalDatabase'), c.get('site').siteKey, 'email_verification', issued.email, { code: issued.code, email: issued.email, expires_minutes: '10' }); }
			catch (error) { await discardExternalEmailOtp(database, pending.id_hash); return apiMessage(c, 502, error instanceof Error ? error.message : '邮箱验证码发送失败'); }
			return apiResponse(c, 200, { status: 'email_sent' });
		}
		const verified = await verifyExternalEmailOtp(database, c.env.SNOWFLAKE_WORKER_ID, pending, String(body.code ?? ''));
		if (verified.status !== 'created') return apiMessage(c, 409, verified.status === 'conflict' ? verified.message : verified.status === 'expired' ? '验证码已过期' : '验证码不正确');
		const sessionId = crypto.randomUUID(), now = Date.now(), maxAge = 24 * 60 * 60;
		await runSql(database, sql(database).insert('passport_sessions', { id: sessionId, user_id: verified.userId, expires_at: now + maxAge * 1000, created_at: now }));
		await runSql(database, sql(database).update('passport_external_login_states', { qr_status: 'consumed', qr_user_id: verified.userId }, { id_hash: await sha256(bindState) }));
		c.header('Set-Cookie', createPassportSessionCookie(sessionId, secure, maxAge));
		// 二维码页可能开在业务站点的登录弹窗里，必须把后续去向一并返回，不能让它自己跳首页。
		return apiResponse(c, 200, { status: 'completed', redirectTo: await postLoginRedirect(c, database, verified.userId) });
	}
	if (c.req.method !== 'GET') return apiMessage(c, 400, '缺少邮箱绑定状态');
	const publicOrigin = c.get('systemConfig').publicOrigin?.trim();
	const configuredOrigin = id === 'wechat' && provider.wechat_redirect_domain ? `${isSecureRequest(c) ? 'https' : 'http'}://${provider.wechat_redirect_domain}` : (publicOrigin || requestOrigin(c));
	const redirectUri = new URL(`/api/accounts/external/${id}`, configuredOrigin).toString();
	const code = c.req.query('code')?.trim(), returnedState = c.req.query('state')?.trim();
	const pollState = c.req.query('poll')?.trim();
	if (pollState) {
		const polled = await externalQrState(database, await sha256(pollState));
		// 过期是正常轮询结果，不能用错误状态码，否则通用请求层会弹出"请求失败"。
		if (!polled || polled.provider !== id || polled.expires_at <= Date.now()) return apiResponse(c, 200, { status: 'expired' });
		if (polled.qr_status === 'authorized' && !polled.qr_user_id) return apiResponse(c, 200, { status: 'needs_email', bindUrl: `/api/accounts/external/${id}?bind=${encodeURIComponent(pollState)}` });
		if (polled.qr_status !== 'authorized' || !polled.qr_user_id) return apiResponse(c, 200, { status: polled.qr_status });
		const current = await loadPassportSession(database, c.req.raw);
		const sessionId = crypto.randomUUID(), now = Date.now();
		await runSql(database, sql(database).insert('passport_sessions', { id: sessionId, user_id: polled.qr_user_id, device_id: await ensurePassportDevice(database, polled.qr_user_id, c.req.raw), expires_at: now + 24 * 60 * 60 * 1000, created_at: now }));
		await runSql(database, sql(database).update('passport_external_login_states', { qr_status: 'consumed' }, [{ column: 'id_hash', value: await sha256(pollState) }, { column: 'qr_status', value: 'authorized' }]));
		c.header('Set-Cookie', createPassportSessionCookie(sessionId, secure, 24 * 60 * 60));
		const redirectTo = current && String(current.id) === String(polled.qr_user_id)
			? `/panel/accounts/identities${c.get('techStackConfig').pageSuffix}`
			: await postLoginRedirect(c, database, String(polled.qr_user_id));
		return apiResponse(c, 200, { status: 'authenticated', redirectTo });
	}
	if (!code && !returnedState) {
		const created = await createExternalState(database, id, redirectUri);
		// 二维码在电脑端发起时记住当前 Accounts 用户；手机只负责确认外部身份，电脑端无需再次走邮箱验证。
		if (id === 'wechat' && provider.wechat_mode === 'official_account') {
			const current = await loadPassportSession(database, c.req.raw);
			if (current) await runSql(database, sql(database).update('passport_external_login_states', { qr_user_id: String(current.id) }, { id_hash: await sha256(created.state) }));
		}
		c.header('Set-Cookie', externalStateCookie(created.state, secure));
		const authorizationUrl = await externalAuthorizationUrl(provider, redirectUri, created.state, created.nonce, created.codeVerifier);
		const isWechatClient = /MicroMessenger/i.test(c.req.header('user-agent') ?? '');
		if (id === 'wechat' && provider.wechat_mode === 'official_account' && !isWechatClient) {
			if (c.req.query('format') === 'json') return apiResponse(c, 200, { mode: 'qrcode', authorizationUrl, pollUrl: `/api/accounts/external/${id}?poll=${created.state}` });
			const pageSuffix = c.get('techStackConfig').pageSuffix || '';
			return c.redirect(`/accounts/external/${id}${pageSuffix}`, 302);
		}
		return c.redirect(authorizationUrl, 302);
	}
	const consume = c.req.query('consume') === '1';
	if (id === 'wechat' && provider.wechat_mode === 'official_account' && (code || c.req.query('error')) && !consume) {
		const pageSuffix = c.get('techStackConfig').pageSuffix || '';
		const target = new URL(`/accounts/external/callback${pageSuffix}`, requestOrigin(c));
		for (const key of ['provider', 'code', 'state', 'error', 'error_description']) { const value = c.req.query(key); if (value) target.searchParams.set(key, value); }
		return c.redirect(target.toString(), 302);
	}
	const providerError = c.req.query('error');
	if (providerError) {
		c.header('Set-Cookie', clearExternalStateCookie(secure));
		return apiMessage(c, 400, `外部授权未完成：${c.req.query('error_description') || providerError}`);
	}
	if (!code || !returnedState) return apiMessage(c, 400, '外部授权回调缺少 code 或 state');
	const cookieState = readCookie(c.req.raw, externalStateCookieName);
	if ((!cookieState || cookieState !== returnedState) && !(id === 'wechat' && provider.wechat_mode === 'official_account')) return apiMessage(c, 400, '外部授权 state 与当前浏览器不匹配，请重新登录');
	const qrState = id === 'wechat' && provider.wechat_mode === 'official_account' && !cookieState
		? await externalQrState(database, await sha256(returnedState))
		: null;
	const state = await consumeExternalState(database, returnedState);
	if (!state || state.provider !== id || state.redirect_uri !== redirectUri) return apiMessage(c, 400, '外部授权请求不存在、已过期或已经使用');
	try {
		const profile = await fetchExternalProfile(provider, code, state, c.env.OIDC_FETCH ?? fetch);
		const current = await loadPassportSession(database, c.req.raw);
		// 已经绑定过的外部身份直接登录，即使身份源不提供邮箱也不再要求验证码。
		const bound = await externalIdentityUser(database, provider.id, profile.subject);
		if (!current && !bound && !profile.email) {
			if (provider.wechat_mode === 'official_account' && !cookieState && consume) {
				if (qrState?.qr_user_id) {
					const userId = await resolveExternalUser(database, c.env.SNOWFLAKE_WORKER_ID, provider, profile, qrState.qr_user_id);
					await runSql(database, sql(database).update('passport_external_login_states', { qr_status: 'authorized', qr_user_id: userId }, { id_hash: await sha256(returnedState) }));
					return apiResponse(c, 200, { status: 'authorized' });
				}
				await createPendingExternalIdentity(database, profile, provider.id, await sha256(returnedState));
				await runSql(database, sql(database).update('passport_external_login_states', { qr_status: 'authorized' }, [{ column: 'id_hash', value: await sha256(returnedState) }]));
				return apiResponse(c, 200, { status: 'authorized' });
			}
			const pendingToken = await createPendingExternalIdentity(database, profile, provider.id);
			c.header('Set-Cookie', clearExternalStateCookie(secure));
			c.header('Set-Cookie', externalPendingCookie(pendingToken, secure), { append: true });
			return c.redirect(`/accounts/sign${c.get('techStackConfig').pageSuffix}`, 302);
		}
		const userId = await resolveExternalUser(database, c.env.SNOWFLAKE_WORKER_ID, provider, profile, current?.id ? String(current.id) : undefined);
		// 身份源带头像时后台同步到对象存储，失败不影响登录。
		const avatarUrl = externalAvatarUrl(provider.id, profile.raw);
		if (avatarUrl) {
			const task = syncExternalAvatar(c.get('globalDatabase'), c.get('site').siteKey, userId, avatarUrl, c.env.OIDC_FETCH ?? fetch)
				.catch((error) => console.error('头像同步失败', error));
			try { c.executionCtx.waitUntil(task); }
			catch { void task; }
		}
		if (provider.wechat_mode === 'official_account' && !cookieState) {
			await runSql(database, sql(database).update('passport_external_login_states', { qr_status: 'authorized', qr_user_id: userId }, [{ column: 'id_hash', value: await sha256(returnedState) }]));
			// consume=1 来自手机上的回调页面，它按 JSON 解析响应；直接用浏览器打开时才返回提示页面。
			return consume ? apiResponse(c, 200, { status: 'signed_in' }) : c.html('<p>授权成功，请返回电脑页面。</p>');
		}
		if (current) {
			// 已登录用户完成一次第三方认证：用于绑定身份、绑定邮箱或重设密码，按发起页面返回。
			c.header('Set-Cookie', clearExternalStateCookie(secure));
			c.header('Set-Cookie', externalVerifiedCookie(secure), { append: true });
			const requested = readCookie(c.req.raw, bindReturnCookieName) ?? '';
			const pageSuffix = c.get('techStackConfig').pageSuffix;
			// 只接受账户中心内部路径，避免被引导到站外。
			const bindTarget = /^\/panel\/accounts\/[a-z-]+(\.[a-z]+)?$/.test(requested) ? requested : `/panel/accounts/bind-email${pageSuffix}`;
			if (requested) c.header('Set-Cookie', clearBindReturnCookie(secure), { append: true });
			return consume ? apiResponse(c, 200, { status: 'linked', redirectTo: bindTarget }) : c.redirect(bindTarget, 302);
		}
		const sessionId = crypto.randomUUID(), now = Date.now(), maxAge = 24 * 60 * 60;
		await runSql(database, sql(database).insert('passport_sessions', { id: sessionId, user_id: userId, device_id: await ensurePassportDevice(database, userId, c.req.raw), expires_at: now + maxAge * 1000, created_at: now }));
		c.header('Set-Cookie', clearExternalStateCookie(secure));
		c.header('Set-Cookie', createPassportSessionCookie(sessionId, secure, maxAge), { append: true });
		// 第三方认证通过：30 分钟内允许发送邮箱验证码、重设密码。
		c.header('Set-Cookie', externalVerifiedCookie(secure), { append: true });
		// 去向由后端统一决定：先补全用户名和密码，再继续待处理的 OIDC 授权。
		const target = await postLoginRedirect(c, database, userId);
		// consume=1 来自手机上的回调页面，它按 JSON 解析响应，不能返回跳转。
		return consume ? apiResponse(c, 200, { status: 'signed_in', redirectTo: target }) : c.redirect(target, 302);
	} catch (error) {
		c.header('Set-Cookie', clearExternalStateCookie(secure));
		const message = error instanceof Error ? error.message : '外部身份登录失败';
		return apiMessage(c, 400, message);
	}
};

export const acceptsTrailingParams = true;
export default handler;
