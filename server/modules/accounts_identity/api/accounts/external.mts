import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { clearExternalStateCookie, consumeExternalState, createExternalState, createPendingExternalIdentity, discardExternalEmailOtp, externalAuthorizationUrl, externalPendingCookie, externalProvider, externalQrState, externalStateCookie, externalIdentityUser, externalStateCookieName, externalVerifiedCookie, fetchExternalProfile, issueExternalEmailOtp, pendingExternalIdentityByQrState, resolveExternalUser, verifyExternalEmailOtp, type ExternalProviderId } from '@server/accounts/external.mjs';
import { clearOidcRequestCookie, oidcRequestCookieName, readCookie } from '@server/accounts/oidc.mjs';
import { accountOnboarding, refreshOidcRequest } from '@server/accounts/onboarding.mjs';
import { createPassportSessionCookie, loadPassportSession } from '@server/passport/session.mjs';
import { runSql, sql } from '@server/database/sql.mjs';
import { isSecureRequest, requestOrigin } from '@server/request-origin.mjs';
import { sha256 } from '@server/accounts/oidc.mjs';
import { sendDefaultCloudEmail } from '@server/cloud/email.mjs';

const providerId = (value: string): ExternalProviderId | undefined => value === 'google' || value === 'wechat' ? value : undefined;

const handler: ApiHandler = async (c, _next, params) => {
	if (c.get('site').siteKey !== 'passport' || !['GET', 'POST'].includes(c.req.method)) return apiMessage(c, 404);
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
			try { await sendDefaultCloudEmail(c.get('globalDatabase'), 'passport', 'email_verification', issued.email, { code: issued.code, email: issued.email, expires_minutes: '10' }); }
			catch (error) { await discardExternalEmailOtp(database, pending.id_hash); return apiMessage(c, 502, error instanceof Error ? error.message : '邮箱验证码发送失败'); }
			return apiResponse(c, 200, { status: 'email_sent' });
		}
		const verified = await verifyExternalEmailOtp(database, c.env.SNOWFLAKE_WORKER_ID, pending, String(body.code ?? ''));
		if (verified.status !== 'created') return apiMessage(c, 409, verified.status === 'conflict' ? verified.message : verified.status === 'expired' ? '验证码已过期' : '验证码不正确');
		const sessionId = crypto.randomUUID(), now = Date.now(), maxAge = 24 * 60 * 60;
		await runSql(database, sql(database).insert('passport_sessions', { id: sessionId, user_id: verified.userId, expires_at: now + maxAge * 1000, created_at: now }));
		await runSql(database, sql(database).update('passport_external_login_states', { qr_status: 'consumed', qr_user_id: verified.userId }, { id_hash: await sha256(bindState) }));
		c.header('Set-Cookie', createPassportSessionCookie(sessionId, secure, maxAge));
		return apiResponse(c, 200, { status: 'completed' });
	}
	if (c.req.method !== 'GET') return apiMessage(c, 400, '缺少邮箱绑定状态');
	const publicOrigin = c.get('systemConfig').publicOrigin?.trim();
	const configuredOrigin = id === 'wechat' && provider.wechat_redirect_domain ? `${isSecureRequest(c) ? 'https' : 'http'}://${provider.wechat_redirect_domain}` : (publicOrigin || requestOrigin(c));
	const redirectUri = new URL(`/api/accounts/external/${id}`, configuredOrigin).toString();
	const code = c.req.query('code')?.trim(), returnedState = c.req.query('state')?.trim();
	const pollState = c.req.query('poll')?.trim();
	if (pollState) {
		const polled = await externalQrState(database, await sha256(pollState));
		if (!polled || polled.provider !== id || polled.expires_at <= Date.now()) return apiResponse(c, 410, { status: 'expired' });
		if (polled.qr_status === 'authorized' && !polled.qr_user_id) return apiResponse(c, 200, { status: 'needs_email', bindUrl: `/api/accounts/external/${id}?bind=${encodeURIComponent(pollState)}` });
		if (polled.qr_status !== 'authorized' || !polled.qr_user_id) return apiResponse(c, 200, { status: polled.qr_status });
		const sessionId = crypto.randomUUID(), now = Date.now();
		await runSql(database, sql(database).insert('passport_sessions', { id: sessionId, user_id: polled.qr_user_id, expires_at: now + 24 * 60 * 60 * 1000, created_at: now }));
		await runSql(database, sql(database).update('passport_external_login_states', { qr_status: 'consumed' }, [{ column: 'id_hash', value: await sha256(pollState) }, { column: 'qr_status', value: 'authorized' }]));
		c.header('Set-Cookie', createPassportSessionCookie(sessionId, secure, 24 * 60 * 60));
		return apiResponse(c, 200, { status: 'authenticated' });
	}
	if (!code && !returnedState) {
		const created = await createExternalState(database, id, redirectUri);
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
	const state = await consumeExternalState(database, returnedState);
	if (!state || state.provider !== id || state.redirect_uri !== redirectUri) return apiMessage(c, 400, '外部授权请求不存在、已过期或已经使用');
	try {
		const profile = await fetchExternalProfile(provider, code, state, c.env.OIDC_FETCH ?? fetch);
		const current = await loadPassportSession(database, c.req.raw);
		// 已经绑定过的外部身份直接登录，即使身份源不提供邮箱也不再要求验证码。
		const bound = await externalIdentityUser(database, provider.id, profile.subject);
		if (!current && !bound && !profile.email) {
			if (provider.wechat_mode === 'official_account' && !cookieState && consume) {
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
		if (provider.wechat_mode === 'official_account' && !cookieState) {
			await runSql(database, sql(database).update('passport_external_login_states', { qr_status: 'authorized', qr_user_id: userId }, [{ column: 'id_hash', value: await sha256(returnedState) }]));
			return c.html('<p>授权成功，请返回电脑页面。</p>');
		}
		if (current) {
			// 已登录用户完成一次第三方认证，用于随后的邮箱绑定或密码重设。
			c.header('Set-Cookie', clearExternalStateCookie(secure));
			c.header('Set-Cookie', externalVerifiedCookie(secure), { append: true });
			return c.redirect(`/panel/accounts/bind-email${c.get('techStackConfig').pageSuffix}`, 302);
		}
		const sessionId = crypto.randomUUID(), now = Date.now(), maxAge = 24 * 60 * 60;
		await runSql(database, sql(database).insert('passport_sessions', { id: sessionId, user_id: userId, expires_at: now + maxAge * 1000, created_at: now }));
		c.header('Set-Cookie', clearExternalStateCookie(secure));
		c.header('Set-Cookie', createPassportSessionCookie(sessionId, secure, maxAge), { append: true });
		// 第三方认证通过：30 分钟内允许发送邮箱验证码、重设密码。
		c.header('Set-Cookie', externalVerifiedCookie(secure), { append: true });
		// 还没有用户名或密码时先回登录页补全，补全完成后再由登录页回跳授权。
		if ((await accountOnboarding(database, userId)).step !== 'done') {
			await refreshOidcRequest(c, database);
			return c.redirect(`/accounts/sign${c.get('techStackConfig').pageSuffix}`, 302);
		}
		const oidcRequestId = readCookie(c.req.raw, oidcRequestCookieName);
		if (oidcRequestId) c.header('Set-Cookie', clearOidcRequestCookie(secure), { append: true });
		return c.redirect(oidcRequestId ? `/api/oidc/authorize?request_id=${encodeURIComponent(oidcRequestId)}` : '/', 302);
	} catch (error) {
		c.header('Set-Cookie', clearExternalStateCookie(secure));
		const message = error instanceof Error ? error.message : '外部身份登录失败';
		return apiMessage(c, 400, message);
	}
};

export const acceptsTrailingParams = true;
export default handler;
