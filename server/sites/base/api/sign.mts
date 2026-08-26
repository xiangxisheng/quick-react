import type { ApiHandler } from '@server/api-router.mjs';
import { clearSessionCookie, createSessionCookie, createStoredPassword, readSessionId, verifyStoredPassword } from '@server/auth.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import type { FormPageConfig } from '@shared/types/form-page.mjs';
import { firstSql, runSql, sql } from '@server/database/sql.mjs';

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

const handler: ApiHandler = async (c, next) => {
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
		if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(credentials.username) || credentials.password.length < 8) {
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
		return apiMessageData(c, 200, '登录成功', { user: { id: user.id, username: user.username } });
	}
	if (c.req.method === 'DELETE') {
		const sessionId = readSessionId(c.req.raw);
		if (sessionId) await runSql(database, sql(database).delete('base_system_sessions', { id: sessionId }));
		c.header('Set-Cookie', clearSessionCookie(new URL(c.req.url).protocol === 'https:'));
		return apiMessage(c, 200, '已退出登录');
	}
	return next();
};

export default handler;
