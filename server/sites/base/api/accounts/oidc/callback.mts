import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiMessage } from '@server/modules/base/api-response.mjs';
import { clearAccountsLoginCookie, accountsLoginCookieName, loadAccountsOidcConfig, loadDiscovery, oidcFetch, verifyIdToken } from '@server/accounts/client.mjs';
import { readCookie } from '@server/accounts/oidc.mjs';
import { isValidAccountUsername } from '@server/passport/account.mjs';
import { createSessionCookie } from '@server/modules/base/auth.mjs';
import { firstSql, runSql, sql } from '@server/database/sql.mjs';
import { isSecureRequest, requestOrigin } from '@server/modules/base/request-origin.mjs';

type LoginRequest = { id: string; issuer: string; state: string; nonce: string; code_verifier: string; return_path: string; expires_at: number };

/** 弹窗登录成功后通知打开方并自行关闭；内容是静态的，不拼接任何外部输入。 */
const popupClosePage = () => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>登录成功</title></head>`
	+ `<body style="font-family:system-ui;padding:48px;text-align:center"><h2>登录成功</h2><p>正在返回原页面…</p>`
	+ `<script>window.opener&&window.opener.postMessage({source:'passport',status:'success',next:{action:'reload'}},window.location.origin);setTimeout(function(){window.close();},100);</script>`
	+ `</body></html>`;

/** 未设置 Accounts 用户名时的本站占位用户名，带下划线，永远不会与合法用户名冲突。 */
const placeholderUsername = (subject: string) => `passport_${subject}`;
const generatedUsername = (username: string) => username.startsWith('passport_') || username.startsWith('accounts_');

/** Accounts 设置用户名后同步改写本站占位用户名；管理员手工改过的名字不覆盖。 */
const syncLocalUsername = async (database: Parameters<typeof runSql>[0], userId: number, username: string) => {
	const current = await firstSql<{ username: string }>(database, sql(database).select({ table: 'base_system_users', columns: { username: 'username' }, where: [{ column: 'id', value: userId }] }));
	if (!current || current.username === username || !generatedUsername(current.username)) return;
	const taken = await firstSql(database, sql(database).select({ table: 'base_system_users', columns: { id: 'id' }, where: [{ column: 'username', value: username }] }));
	if (taken) return;
	await runSql(database, sql(database).update('base_system_users', { username, updated_at: Date.now() }, { id: userId }));
};

const handler: ApiHandler = async (c) => {
	if (c.req.method !== 'GET') return apiMessage(c, 405, '只允许 GET 请求');
	const database = c.get('database'), config = await loadAccountsOidcConfig(c);
	if (!config.enabled) return apiMessage(c, 404, '本站未启用 Accounts OIDC 登录');
	const requestId = readCookie(c.req.raw, accountsLoginCookieName), state = c.req.query('state') ?? '', code = c.req.query('code') ?? '';
	const requestColumns = { id: 'id', issuer: 'issuer', state: 'state', nonce: 'nonce', code_verifier: 'code_verifier', return_path: 'return_path', expires_at: 'expires_at' } as const;
	const request = requestId
		? await firstSql<LoginRequest>(database, sql(database).select({ table: 'base_oidc_login_requests', columns: requestColumns, where: [{ column: 'id', value: requestId }] }))
		: state ? await firstSql<LoginRequest>(database, sql(database).select({ table: 'base_oidc_login_requests', columns: requestColumns, where: [{ column: 'state', value: state }] })) : undefined;
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
		const preferred = typeof claims.preferred_username === 'string' ? claims.preferred_username : '';
		if (!account) {
			// 先用占位用户名建号，再按 Accounts 用户名改写，避免撞上本站已有的同名账号。
			const username = placeholderUsername(subject);
			await runSql(database, sql(database).ignoreInsert('base_system_users', ['username'], { username, password: '!oidc', roles: '[]', status: 'enabled', created_at: now, updated_at: now }));
			const user = await firstSql<{ id: number; status: string; password: string }>(database, sql(database).select({ table: 'base_system_users', columns: { id: 'id', status: 'status', password: 'password' }, where: [{ column: 'username', value: username }] }));
			if (!user) throw new Error('无法创建本站 Accounts 用户');
			if (user.password !== '!oidc') throw new Error('本站已存在同名用户，无法绑定 Accounts 身份');
			await runSql(database, sql(database).insert('base_oidc_accounts', { issuer: config.issuer, subject, user_id: user.id, profile: JSON.stringify(claims), created_at: now, updated_at: now }));
			account = { user_id: user.id, status: user.status };
		} else {
			await runSql(database, sql(database).update('base_oidc_accounts', { profile: JSON.stringify(claims), updated_at: now }, { issuer: config.issuer, subject }));
		}
		if (isValidAccountUsername(preferred)) await syncLocalUsername(database, account.user_id, preferred);
		if (account.status !== 'enabled') return apiMessage(c, 403, '本站用户已停用');
		const maxAge = 24 * 60 * 60;
		const previousSession = await firstSql<{ session_id: string }>(database, sql(database).select({ table: 'base_oidc_sessions', columns: { session_id: 'session_id' }, where: [{ column: 'issuer', value: config.issuer }, { column: 'sid', value: oidcSessionId }] }));
		const sessionId = previousSession?.session_id ?? crypto.randomUUID();
		if (previousSession) await runSql(database, sql(database).update('base_system_sessions', { user_id: account.user_id, expires_at: now + maxAge * 1000 }, { id: sessionId }));
		else await runSql(database, sql(database).insert('base_system_sessions', { id: sessionId, user_id: account.user_id, expires_at: now + maxAge * 1000, created_at: now }));
		await runSql(database, sql(database).upsert('base_oidc_sessions', ['issuer', 'sid'], { issuer: config.issuer, sid: oidcSessionId, session_id: sessionId, created_at: now }, ['session_id', 'created_at']));
		await runSql(database, sql(database).delete('base_oidc_login_requests', { id: request.id }));
		const secure = isSecureRequest(c);
		c.header('Set-Cookie', clearAccountsLoginCookie(secure)); c.header('Set-Cookie', createSessionCookie(sessionId, secure, maxAge), { append: true });
		// 登录只在弹窗里完成：直接返回关闭窗口的页面，不再中转到额外的回调页面。
		return c.html(popupClosePage());
	} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : 'Accounts 登录回调失败'); }
};
export default handler;
