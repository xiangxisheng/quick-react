import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage } from '@server/api-response.mjs';
import { clearExternalStateCookie, consumeExternalState, createExternalState, createPendingExternalIdentity, externalAuthorizationUrl, externalPendingCookie, externalProvider, externalStateCookie, externalStateCookieName, fetchExternalProfile, resolveExternalUser, type ExternalProviderId } from '@server/accounts/external.mjs';
import { clearOidcRequestCookie, oidcRequestCookieName, readCookie } from '@server/accounts/oidc.mjs';
import { createPassportSessionCookie, loadPassportSession } from '@server/passport/session.mjs';
import { runSql, sql } from '@server/database/sql.mjs';

const providerId = (value: string): ExternalProviderId | undefined => value === 'google' || value === 'wechat' ? value : undefined;

const handler: ApiHandler = async (c, _next, params) => {
	if (c.get('site').siteKey !== 'passport' || c.req.method !== 'GET') return apiMessage(c, 404);
	const database = c.get('passportDatabase'), id = providerId(params.id);
	if (!database) return apiMessage(c, 503, 'Accounts 数据库不可用');
	if (!id) return apiMessage(c, 404, '外部身份源不存在');
	const provider = await externalProvider(database, id);
	if (!provider) return apiMessage(c, 404, `${id === 'google' ? 'Google' : '微信'}登录尚未启用`);
	const requestUrl = new URL(c.req.url), secure = requestUrl.protocol === 'https:';
	const publicOrigin = c.get('systemConfig').publicOrigin?.trim();
	const redirectUri = new URL(`/api/accounts/external/${id}`, publicOrigin || requestUrl.origin).toString();
	const code = c.req.query('code')?.trim(), returnedState = c.req.query('state')?.trim();
	if (!code && !returnedState) {
		const created = await createExternalState(database, id, redirectUri);
		c.header('Set-Cookie', externalStateCookie(created.state, secure));
		return c.redirect(await externalAuthorizationUrl(provider, redirectUri, created.state, created.nonce, created.codeVerifier), 302);
	}
	const providerError = c.req.query('error');
	if (providerError) {
		c.header('Set-Cookie', clearExternalStateCookie(secure));
		return apiMessage(c, 400, `外部授权未完成：${c.req.query('error_description') || providerError}`);
	}
	if (!code || !returnedState) return apiMessage(c, 400, '外部授权回调缺少 code 或 state');
	const cookieState = readCookie(c.req.raw, externalStateCookieName);
	if (!cookieState || cookieState !== returnedState) return apiMessage(c, 400, '外部授权 state 与当前浏览器不匹配，请重新登录');
	const state = await consumeExternalState(database, returnedState);
	if (!state || state.provider !== id || state.redirect_uri !== redirectUri) return apiMessage(c, 400, '外部授权请求不存在、已过期或已经使用');
	try {
		const profile = await fetchExternalProfile(provider, code, state, c.env.OIDC_FETCH ?? fetch);
		const current = await loadPassportSession(database, c.req.raw);
		if (!current && !profile.email) {
			const pendingToken = await createPendingExternalIdentity(database, profile, provider.id);
			c.header('Set-Cookie', clearExternalStateCookie(secure));
			c.header('Set-Cookie', externalPendingCookie(pendingToken, secure), { append: true });
			return c.redirect(`/accounts/sign${c.get('techStackConfig').pageSuffix}`, 302);
		}
		const userId = await resolveExternalUser(database, c.env.SNOWFLAKE_WORKER_ID, provider, profile, current?.id ? String(current.id) : undefined);
		const sessionId = crypto.randomUUID(), now = Date.now(), maxAge = 24 * 60 * 60;
		await runSql(database, sql(database).insert('passport_sessions', { id: sessionId, user_id: userId, expires_at: now + maxAge * 1000, created_at: now }));
		c.header('Set-Cookie', clearExternalStateCookie(secure));
		c.header('Set-Cookie', createPassportSessionCookie(sessionId, secure, maxAge), { append: true });
		const oidcRequestId = readCookie(c.req.raw, oidcRequestCookieName);
		if (oidcRequestId) c.header('Set-Cookie', clearOidcRequestCookie(secure), { append: true });
		return c.redirect(oidcRequestId ? `/api/oidc/authorize?request_id=${encodeURIComponent(oidcRequestId)}` : '/', 302);
	} catch (error) {
		c.header('Set-Cookie', clearExternalStateCookie(secure));
		return apiMessage(c, 400, error instanceof Error ? error.message : '外部身份登录失败');
	}
};

export const acceptsTrailingParams = true;
export default handler;
