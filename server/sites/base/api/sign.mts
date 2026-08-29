import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { clearSessionCookie, createSessionCookie, createStoredPassword, readSessionId, verifyStoredPassword } from '@server/modules/base/auth/index.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/modules/base/api-response.mjs';
import type { FormPageConfig } from '@shared/types/form-page.mjs';
import { firstSql, runSql, sql } from '@server/database/sql.mjs';
import { accountsLoginCookie, loadAccountsOidcConfig, loadDiscovery, oidcFetch } from '@server/modules/passport/accounts/client.mjs';
import { randomToken, sha256Base64Url } from '@server/modules/passport/accounts/oidc.mjs';
import { isSecureRequest, requestOrigin } from '@server/modules/base/request-origin.mjs';
import { clearPassportSessionCookie } from '@server/modules/passport/session.mjs';
import { passwordError } from '@server/modules/base/auth/password-policy.mjs';

const parseCredentials = async (c: Parameters<ApiHandler>[0]) => {
	let body: Record<string, unknown> = {};
	try { body = await c.req.json<Record<string, unknown>>(); }
	catch { /* Invalid JSON is handled as empty credentials. */ }
	return {
		username: String(body.username ?? '').trim().slice(0, 64),
		password: String(body.password ?? ''),
		remember: body.remember === true,
	};
};

const registrationAvailable = async (database: DatabaseAdapter) => {
	const row = await firstSql<{ value: string }>(database, sql(database).select({ table: 'base_system_bootstrap', columns: { value: 'value' }, where: [{ column: 'key', value: 'initial_admin' }] }));
	return row?.value === 'open';
};

/** 本站账号密码登录：Accounts 登录未启用时使用，也是启用后仍保留的站点管理员入口。 */
const localSign: ApiHandler = async (c, next) => {
	const database = c.get('database');
	if (c.req.method === 'GET') {
		const isSignUp = new URL(c.req.url).searchParams.get('mode') === 'sign-up';
		const formPage: FormPageConfig = {
			initialValues: { username: '', password: '', ...(isSignUp ? { password_confirm: '' } : {}), remember: false },
			submitLabel: isSignUp ? '注册' : '登录',
			fields: [
				{ name: 'username', label: '用户名', maxLength: 64, rules: [{ required: true, message: '请输入用户名' }] },
				{ name: 'password', label: '密码', type: 'password', rules: [{ required: true, message: '请输入密码' }] },
				...(isSignUp ? [{ name: 'password_confirm', label: '确认密码', type: 'password' as const, rules: [{ required: true, message: '请确认密码' }] }] : []),
				...(!isSignUp ? [{ name: 'remember', label: '记住我', type: 'switch' as const }] : []),
			],
		};
		return apiResponse(c, 200, {
			user: c.get('currentUser') ?? null,
			registrationAvailable: await registrationAvailable(database),
			formPage,
		});
	}
	if (c.req.method === 'PUT') {
		if (!await registrationAvailable(database)) return apiMessage(c, 409, '初始管理员已经存在');
		const credentials = await parseCredentials(c);
		if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(credentials.username) || passwordError(credentials.password)) {
			return apiMessage(c, 400, '用户名至少 3 个合法字符，密码至少 8 个字符');
		}
		const now = Date.now();
		const storedPassword = await createStoredPassword(credentials.password);
		const claimed = await runSql(database, sql(database).update('base_system_bootstrap', { value: 'claimed' }, [{ column: 'key', value: 'initial_admin' }, { column: 'value', value: 'open' }]));
		if (Number(claimed.meta?.changes ?? 0) !== 1) return apiMessage(c, 409, '初始管理员已经存在');
		try {
			await runSql(database, sql(database).insert('base_system_users', { username: credentials.username, password: storedPassword, roles: '["admin"]', status: 'enabled', created_at: now, updated_at: now }));
		} catch (error) {
			await runSql(database, sql(database).update('base_system_bootstrap', { value: 'open' }, [{ column: 'key', value: 'initial_admin' }, { column: 'value', value: 'claimed' }]));
			throw error;
		}
		return apiMessage(c, 201, '初始管理员创建成功，请登录');
	}
	if (c.req.method === 'POST') {
		const credentials = await parseCredentials(c);
		const user = await firstSql<{ id: number; username: string; password: string; roles: string }>(database, sql(database).select({ table: 'base_system_users', columns: { id: 'id', username: 'username', password: 'password', roles: 'roles' }, where: [{ column: 'username', value: credentials.username }, { column: 'status', value: 'enabled' }] }));
		if (!user || !await verifyStoredPassword(credentials.password, user.password)) return apiMessage(c, 401, '用户名或密码错误', { component: 'modal', type: 'error' });
		const sessionId = crypto.randomUUID();
		const maxAge = credentials.remember ? 30 * 24 * 60 * 60 : 24 * 60 * 60;
		const now = Date.now();
		await runSql(database, sql(database).insert('base_system_sessions', { id: sessionId, user_id: user.id, expires_at: now + maxAge * 1000, created_at: now }));
		c.header('Set-Cookie', createSessionCookie(sessionId, new URL(c.req.url).protocol === 'https:', maxAge));
		return apiMessageData(c, 200, '登录成功', { user: { id: user.id, username: user.username }, next: { action: 'reload' } });
	}
	if (c.req.method === 'DELETE') {
		const sessionId = readSessionId(c.req.raw);
		if (sessionId) await runSql(database, sql(database).delete('base_system_sessions', { id: sessionId }));
		c.header('Set-Cookie', clearSessionCookie(new URL(c.req.url).protocol === 'https:'));
		if (c.req.query('logout') !== 'local') c.header('Set-Cookie', clearPassportSessionCookie(isSecureRequest(c)), { append: true });
		return apiMessageData(c, 200, '已退出登录', { next: { action: 'reload' } });
	}
	return next();
};

/** 登录入口：站点在系统设置里启用 Accounts 登录后走 OIDC，否则回落到本站账号密码登录。 */
const handler: ApiHandler = async (c, next) => {
	const config = await loadAccountsOidcConfig(c);
	if (c.get('accountsLoginMode') === 'local') {
		// 未启用 Accounts 登录时，SDK 的登录请求不能被当成本地账号密码登录，否则会报"用户名或密码错误"。
		if (c.req.method === 'POST') {
			const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
			if (body.action === 'login') return apiMessage(c, 409, '本站未启用 Accounts 登录，请使用本站账号密码登录');
			if (typeof body.step === 'string' || 'email' in body) return apiMessage(c, 409, '登录方式已切换为本地账号密码，请刷新页面后重试');
		}
		return localSign(c, next, {});
	}
	if (c.req.method === 'GET') {
		const currentUser = c.get('currentUser') ?? null;
		const formPage: FormPageConfig = {
			description: '使用 Accounts 账号中心完成统一登录。点击下方按钮将打开 Accounts 登录窗口，完成后自动返回本站；本页不会自动跳转。',
			submitLabel: '前往 Accounts 登录',
			passportLogin: { enabled: true },
			initialValues: { action: 'login' },
			fields: [{ name: 'action', label: '', type: 'hidden' }],
		};
		return apiResponse(c, 200, { user: currentUser, registrationAvailable: false, formPage });
	}
	if (c.req.method === 'DELETE') {
		const database = c.get('database'), sessionId = readSessionId(c.req.raw);
		const localOnly = c.req.query('logout') === 'local';
		const oidcSession = !localOnly && sessionId ? await firstSql<{ sid: string }>(database, sql(database).select({
			table: 'base_oidc_sessions', columns: { sid: 'sid' }, where: [{ column: 'issuer', value: config.issuer }, { column: 'session_id', value: sessionId }],
		})) : undefined;
		if (oidcSession) {
			try {
				const discovery = await loadDiscovery(c, config.issuer);
				const response = await oidcFetch(c, discovery.end_session_endpoint || `${config.issuer}/api/oidc/logout`, {
					method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, sid: oidcSession.sid }),
				});
				if (!response.ok) throw new Error(`Accounts 注销请求失败（HTTP ${response.status}）`);
			} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : 'Accounts 注销失败'); }
		}
		if (sessionId) await runSql(database, sql(database).delete('base_system_sessions', { id: sessionId }));
		c.header('Set-Cookie', clearSessionCookie(isSecureRequest(c)));
		if (!localOnly) c.header('Set-Cookie', clearPassportSessionCookie(isSecureRequest(c)), { append: true });
		return apiMessageData(c, 200, '已退出 Accounts 及所有关联站点', { next: { action: 'reload' } });
	}
	if (c.req.method === 'POST') {
		try {
			const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
			if ('username' in body || 'remember' in body) return apiMessage(c, 409, '登录方式已切换为 Accounts 登录，请刷新页面后重试');
			const discovery = await loadDiscovery(c, config.issuer), id = crypto.randomUUID(), state = randomToken(), nonce = randomToken(), verifier = randomToken(48), now = Date.now();
			const database = c.get('database');
			await runSql(database, sql(database).insert('base_oidc_login_requests', { id, issuer: config.issuer, state, nonce, code_verifier: verifier, return_path: '/', expires_at: now + 600_000, created_at: now }));
			const callback = `${requestOrigin(c)}/api/accounts/oidc/callback`;
			const authorize = new URL(discovery.authorization_endpoint); authorize.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: callback, scope: 'openid profile email', state, nonce, code_challenge: await sha256Base64Url(verifier), code_challenge_method: 'S256' }).toString();
			c.header('Set-Cookie', accountsLoginCookie(id, isSecureRequest(c)));
			return apiResponse(c, 200, { redirectTo: authorize.toString(), feedback: { component: 'message', type: 'success', message: '正在前往 Accounts 登录', redirectAfter: 0 } });
		} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : 'Accounts 登录初始化失败'); }
	}
	if (c.req.method === 'PUT') return apiMessage(c, 403, '启用 Accounts 登录后不能创建本地用户');
	return localSign(c, next, {});
};
export default handler;
