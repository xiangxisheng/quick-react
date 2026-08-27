import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage } from '@server/api-response.mjs';
import { clearAccountsLoginCookie, accountsLoginCookieName, loadAccountsOidcConfig, loadDiscovery, oidcFetch, verifyIdToken } from '@server/accounts/client.mjs';
import { readCookie, sha256 } from '@server/accounts/oidc.mjs';
import { createSessionCookie } from '@server/auth.mjs';
import { firstSql, runSql, sql } from '@server/database/sql.mjs';
import { isSecureRequest, requestOrigin } from '@server/request-origin.mjs';

type LoginRequest = { id: string; issuer: string; state: string; nonce: string; code_verifier: string; return_path: string; expires_at: number };

const handler: ApiHandler = async (c) => {
	if (c.req.method !== 'GET') return apiMessage(c, 405, '只允许 GET 请求');
	const database = c.get('database'), config = await loadAccountsOidcConfig(c);
	if (!config.enabled) return apiMessage(c, 404, '本站未启用 Accounts OIDC 登录');
	const requestId = readCookie(c.req.raw, accountsLoginCookieName), state = c.req.query('state') ?? '', code = c.req.query('code') ?? '';
	const request = requestId ? await firstSql<LoginRequest>(database, sql(database).select({ table: 'base_oidc_login_requests', columns: { id: 'id', issuer: 'issuer', state: 'state', nonce: 'nonce', code_verifier: 'code_verifier', return_path: 'return_path', expires_at: 'expires_at' }, where: [{ column: 'id', value: requestId }] })) : undefined;
	if (!request || request.expires_at <= Date.now() || request.issuer !== config.issuer || !state || state !== request.state || !code) return apiMessage(c, 400, 'Accounts 登录回调状态无效或已过期');
	try {
		const discovery = await loadDiscovery(c, config.issuer), callback = `${requestOrigin(c)}/api/accounts/oidc/callback`;
		const tokenResponse = await oidcFetch(c, discovery.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callback, client_id: config.clientId, client_secret: config.clientSecret, code_verifier: request.code_verifier }) });
		if (!tokenResponse.ok) throw new Error(`Accounts Token 请求失败（HTTP ${tokenResponse.status}）`);
		const tokens = await tokenResponse.json() as { id_token?: string };
		if (!tokens.id_token) throw new Error('Accounts 未返回 ID Token');
		const jwksResponse = await oidcFetch(c, discovery.jwks_uri); if (!jwksResponse.ok) throw new Error('Accounts 公钥请求失败');
		const claims = await verifyIdToken(tokens.id_token, await jwksResponse.json() as { keys?: JsonWebKey[] }, { issuer: config.issuer, audience: config.clientId, nonce: request.nonce });
		const subject = String(claims.sub), now = Date.now();
		const oidcSessionId = String(claims.sid ?? ''); if (!oidcSessionId) throw new Error('ID Token 缺少 sid');
		let account = await firstSql<{ user_id: number; status: string }>(database, sql(database).select({ table: 'base_oidc_accounts', alias: 'a', columns: { user_id: 'a.user_id', status: 'u.status' }, joins: [{ table: 'base_system_users', alias: 'u', left: 'u.id', right: 'a.user_id' }], where: [{ column: 'a.issuer', value: config.issuer }, { column: 'a.subject', value: subject }] }));
		if (!account) {
			const suffix = (await sha256(`${config.issuer}\n${subject}`)).slice(0, 16), username = `accounts_${suffix}`;
			await runSql(database, sql(database).ignoreInsert('base_system_users', ['username'], { username, password: '!oidc', roles: '[]', status: 'enabled', created_at: now, updated_at: now }));
			const user = await firstSql<{ id: number; status: string }>(database, sql(database).select({ table: 'base_system_users', columns: { id: 'id', status: 'status' }, where: [{ column: 'username', value: username }] }));
			if (!user) throw new Error('无法创建本站 Accounts 用户');
			await runSql(database, sql(database).insert('base_oidc_accounts', { issuer: config.issuer, subject, user_id: user.id, profile: JSON.stringify(claims), created_at: now, updated_at: now }));
			account = { user_id: user.id, status: user.status };
		} else {
			await runSql(database, sql(database).update('base_oidc_accounts', { profile: JSON.stringify(claims), updated_at: now }, { issuer: config.issuer, subject }));
		}
		if (account.status !== 'enabled') return apiMessage(c, 403, '本站用户已停用');
		const sessionId = crypto.randomUUID(), maxAge = 24 * 60 * 60;
		const previousSession = await firstSql<{ session_id: string }>(database, sql(database).select({ table: 'base_oidc_sessions', columns: { session_id: 'session_id' }, where: [{ column: 'issuer', value: config.issuer }, { column: 'sid', value: oidcSessionId }] }));
		if (previousSession) await runSql(database, sql(database).delete('base_system_sessions', { id: previousSession.session_id }));
		await runSql(database, sql(database).insert('base_system_sessions', { id: sessionId, user_id: account.user_id, expires_at: now + maxAge * 1000, created_at: now }));
		await runSql(database, sql(database).upsert('base_oidc_sessions', ['issuer', 'sid'], { issuer: config.issuer, sid: oidcSessionId, session_id: sessionId, created_at: now }, ['session_id', 'created_at']));
		await runSql(database, sql(database).delete('base_oidc_login_requests', { id: request.id }));
		const secure = isSecureRequest(c);
		c.header('Set-Cookie', clearAccountsLoginCookie(secure)); c.header('Set-Cookie', createSessionCookie(sessionId, secure, maxAge), { append: true });
		return c.redirect(request.return_path || '/', 302);
	} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : 'Accounts 登录回调失败'); }
};
export default handler;
