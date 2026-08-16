import type { ApiHandler } from '@server/api-router.mjs';
import { clearSessionCookie, createSessionCookie, hashPassword, readSessionId, verifyPassword } from '@server/auth.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';

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
	const row = await database.prepare(`SELECT value FROM base_system_bootstrap WHERE key = 'initial_admin'`).first<{ value: string }>();
	return row?.value === 'open';
};

const handler: ApiHandler = async (c, next) => {
	const database = c.get('database');
	if (c.req.method === 'GET') return apiResponse(c, 200, { user: c.get('currentUser') ?? null, registrationAvailable: await registrationAvailable(database) });
	if (c.req.method === 'PUT') {
		if (!await registrationAvailable(database)) return apiMessage(c, 409, '初始管理员已经存在');
		const credentials = await parseCredentials(c);
		if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(credentials.username) || credentials.password.length < 8) {
			return apiMessage(c, 400, '用户名至少 3 个合法字符，密码至少 8 个字符');
		}
		const now = Date.now();
		const passwordHash = await hashPassword(credentials.password);
		const claimed = await database.prepare(`UPDATE base_system_bootstrap SET value = 'claimed'
			WHERE key = 'initial_admin' AND value = 'open'`).run();
		if (Number(claimed.meta?.changes ?? 0) !== 1) return apiMessage(c, 409, '初始管理员已经存在');
		try {
			await database.prepare(`INSERT INTO base_system_users
				(username, password_hash, roles, status, created_at, updated_at) VALUES (?1, ?2, '["admin"]', 'enabled', ?3, ?3)`)
				.bind(credentials.username, passwordHash, now).run();
		} catch (error) {
			await database.prepare(`UPDATE base_system_bootstrap SET value = 'open' WHERE key = 'initial_admin' AND value = 'claimed'`).run();
			throw error;
		}
		return apiMessage(c, 201, '初始管理员创建成功，请登录', { redirectAfter: 1 });
	}
	if (c.req.method === 'POST') {
		const credentials = await parseCredentials(c);
		const user = await database.prepare(`SELECT id, username, password_hash, roles FROM base_system_users
			WHERE username = ?1 AND status = 'enabled'`).bind(credentials.username)
			.first<{ id: number; username: string; password_hash: string; roles: string }>();
		if (!user || !await verifyPassword(credentials.password, user.password_hash)) return apiMessage(c, 401, '用户名或密码错误');
		const sessionId = crypto.randomUUID();
		const maxAge = credentials.remember ? 30 * 24 * 60 * 60 : 24 * 60 * 60;
		const now = Date.now();
		await database.prepare(`INSERT INTO base_system_sessions (id, user_id, expires_at, created_at)
			VALUES (?1, ?2, ?3, ?4)`).bind(sessionId, user.id, now + maxAge * 1000, now).run();
		c.header('Set-Cookie', createSessionCookie(sessionId, new URL(c.req.url).protocol === 'https:', maxAge));
		return apiMessageData(c, 200, '登录成功', { user: { id: user.id, username: user.username } }, { redirectAfter: 1 });
	}
	if (c.req.method === 'DELETE') {
		const sessionId = readSessionId(c.req.raw);
		if (sessionId) await database.prepare('DELETE FROM base_system_sessions WHERE id = ?1').bind(sessionId).run();
		c.header('Set-Cookie', clearSessionCookie(new URL(c.req.url).protocol === 'https:'));
		return apiMessage(c, 200, '已退出登录');
	}
	return next();
};

export default handler;
