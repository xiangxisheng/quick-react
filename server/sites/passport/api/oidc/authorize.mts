import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage } from '@server/api-response.mjs';
import { loadPassportSession, readPassportSessionId } from '@server/passport/session.mjs';
import { accountOnboarding } from '@server/accounts/onboarding.mjs';
import { oidcRequestCookie, randomToken, sha256 } from '@server/accounts/oidc.mjs';
import { runSql, sql } from '@server/database/sql.mjs';
import { authorizationRequest, oidcClient } from '@server/accounts/repository.mjs';
import { isSecureRequest } from '@server/request-origin.mjs';

type Client = { id: string; redirect_uris: string; allowed_scopes: string; require_pkce: number; status: string };
type RequestRow = { client_id: string; redirect_uri: string; scope: string; state: string; nonce: string; code_challenge: string; code_challenge_method: string; expires_at: number };

const handler: ApiHandler = async (c) => {
	if (c.get('site').siteKey !== 'passport' || c.req.method !== 'GET') return apiMessage(c, 404);
	const database = c.get('passportDatabase');
	if (!database) return apiMessage(c, 503, 'Accounts 数据库不可用');
	let values: RequestRow;
	const requestId = c.req.query('request_id')?.trim();
	if (requestId) {
		const stored = await authorizationRequest(database, requestId);
		if (!stored || stored.expires_at <= Date.now()) return apiMessage(c, 400, 'OIDC 授权请求不存在或已过期');
		values = stored;
	} else {
		if (c.req.query('response_type') !== 'code') return apiMessage(c, 400, '仅支持 response_type=code');
		values = {
			client_id: c.req.query('client_id')?.trim() ?? '', redirect_uri: c.req.query('redirect_uri')?.trim() ?? '',
			scope: c.req.query('scope')?.trim() ?? '', state: c.req.query('state') ?? '', nonce: c.req.query('nonce') ?? '',
			code_challenge: c.req.query('code_challenge')?.trim() ?? '', code_challenge_method: c.req.query('code_challenge_method')?.trim() ?? '', expires_at: Date.now() + 600_000,
		};
	}
	const client: Client | null = await oidcClient(database, values.client_id);
	if (!client || client.status !== 'enabled') return apiMessage(c, 400, 'OIDC 客户端不存在或已停用');
	if (!(JSON.parse(client.redirect_uris) as string[]).includes(values.redirect_uri)) return apiMessage(c, 400, 'redirect_uri 未注册');
	const scopes = [...new Set(values.scope.split(/\s+/).filter(Boolean))];
	const allowed = new Set(client.allowed_scopes.split(/\s+/));
	if (!scopes.includes('openid') || scopes.some((scope) => !allowed.has(scope))) return apiMessage(c, 400, '请求的 scope 不被允许');
	if (client.require_pkce && (!/^[A-Za-z0-9_-]{43,128}$/.test(values.code_challenge) || values.code_challenge_method !== 'S256')) return apiMessage(c, 400, '该客户端要求 PKCE S256');
	const current = await loadPassportSession(database, c.req.raw);
	// 未登录，或者已登录但还没有合法用户名，都先回登录页；密码是可跳过项，不在这里拦截，否则跳过后会来回跳。
	const pending = current ? (await accountOnboarding(database, String(current.id))).step === 'username' : false;
	if (!current || pending) {
		const id = requestId || crypto.randomUUID(), now = Date.now();
		if (!requestId) await runSql(database, sql(database).insert('passport_oidc_authorization_requests', { id, client_id: values.client_id, redirect_uri: values.redirect_uri, scope: scopes.join(' '), state: values.state, nonce: values.nonce, code_challenge: values.code_challenge, code_challenge_method: values.code_challenge_method, expires_at: now + 600_000, created_at: now }));
		else await runSql(database, sql(database).update('passport_oidc_authorization_requests', { expires_at: now + 600_000 }, { id }));
		c.header('Set-Cookie', oidcRequestCookie(id, isSecureRequest(c)));
		return c.redirect(`/accounts/sign${c.get('techStackConfig').pageSuffix}`, 302);
	}
	const code = randomToken(32), now = Date.now(), sessionId = readPassportSessionId(c.req.raw) ?? '';
	await runSql(database, sql(database).insert('passport_oidc_authorization_codes', { code_hash: await sha256(code), client_id: values.client_id, user_id: String(current.id), redirect_uri: values.redirect_uri, scope: scopes.join(' '), nonce: values.nonce, code_challenge: values.code_challenge, code_challenge_method: values.code_challenge_method, expires_at: now + 60_000, created_at: now, session_id: sessionId }));
	if (requestId) await runSql(database, sql(database).delete('passport_oidc_authorization_requests', { id: requestId }));
	const redirect = new URL(values.redirect_uri); redirect.searchParams.set('code', code); if (values.state) redirect.searchParams.set('state', values.state);
	return c.redirect(redirect.toString(), 302);
};

export default handler;
