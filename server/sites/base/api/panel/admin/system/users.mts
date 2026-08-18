import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { createStoredPassword, readStoredPassword } from '@server/auth.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';

const columns = [
	{ dataIndex: 'id', title: 'ID', dataType: 'int' as const },
	{ dataIndex: 'username', title: '用户名', component: 'textbox' as const },
	{ dataIndex: 'password', title: '新密码', component: 'textbox' as const, inputType: 'password' as const, placeholder: '留空表示不修改' },
	{ dataIndex: 'roles', title: '角色', component: 'textbox' as const },
	{ dataIndex: 'status', title: '状态', component: 'select' as const, options: [{ value: 'enabled', text: '启用', color: 'green' }, { value: 'disabled', text: '禁用', color: 'red' }] },
	{ dataIndex: 'created_at', title: '创建时间', dataType: 'js_timestamp' as const, dayjsFormat: 'YYYY-MM-DD HH:mm:ss' },
	{ dataIndex: 'updated_at', title: '更新时间', dataType: 'js_timestamp' as const, dayjsFormat: 'YYYY-MM-DD HH:mm:ss' },
];

const publicUser = (row: Record<string, unknown>) => ({
	id: row.id,
	username: row.username,
	password: readStoredPassword(row.password)?.pattern ?? '',
	roles: row.roles,
	status: row.status,
	created_at: row.created_at,
	updated_at: row.updated_at,
});

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	if (c.req.method === 'GET' && !params.id) {
		const rows = await database.prepare('SELECT id, username, roles, status, password, created_at, updated_at FROM base_system_users ORDER BY id DESC').all<Record<string, unknown>>();
		return apiResponse(c, 200, { table: { option: { rowKey: 'id' }, columns, dataSource: rows.results.map(publicUser), totalRecords: rows.results.length } });
	}
	if (params.id && c.req.method === 'GET') {
		const row = await database.prepare('SELECT id, username, roles, status, password, created_at, updated_at FROM base_system_users WHERE id = ?1').bind(params.id).first<Record<string, unknown>>();
		return row ? apiResponse(c, 200, publicUser(row)) : apiMessage(c, 404, '用户不存在');
	}
	if (!params.id && c.req.method === 'POST') {
		const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
		const username = String(body.username ?? '').trim();
		const password = String(body.password ?? '');
		if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username) || password.length < 8) return apiMessage(c, 400, '用户名至少 3 个合法字符，密码至少 8 个字符');
		const now = Date.now();
		try {
			const result = await database.prepare('INSERT INTO base_system_users (username, password, roles, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)')
				.bind(username, await createStoredPassword(password), String(body.roles ?? '["user"]'), String(body.status ?? 'enabled'), now).run();
			return apiMessageData(c, 201, '用户已创建', { id: result.meta?.last_row_id, username });
		} catch {
			return apiMessage(c, 409, '用户名已存在');
		}
	}
	if (params.id && c.req.method === 'PUT') {
		const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
		const current = await database.prepare('SELECT id FROM base_system_users WHERE id = ?1').bind(params.id).first<{ id: number }>();
		if (!current) return apiMessage(c, 404, '用户不存在');
		const changedFields = getChangedFields(body, ['username', 'roles', 'status', 'password']);
		const fields: string[] = [];
		const values: unknown[] = [];
		for (const key of ['username', 'roles', 'status']) {
			if (changedFields.has(key)) {
				fields.push(`${key} = ?${fields.length + 1}`);
				values.push(String(body[key] ?? ''));
			}
		}
		const password = String(body.password ?? '');
		if (changedFields.has('password') && password) {
			fields.push(`password = ?${fields.length + 1}`); values.push(await createStoredPassword(password));
		}
		if (!fields.length) return apiMessage(c, 400, '没有可修改的字段');
		fields.push(`updated_at = ?${fields.length + 1}`); values.push(Date.now()); values.push(params.id);
		try {
			await database.prepare(`UPDATE base_system_users SET ${fields.join(', ')} WHERE id = ?${values.length}`).bind(...values).run();
			return apiMessage(c, 200, '用户已保存');
		} catch { return apiMessage(c, 409, '用户名已存在'); }
	}
	if (params.id && c.req.method === 'DELETE') {
		await database.prepare('DELETE FROM base_system_users WHERE id = ?1').bind(params.id).run();
		return apiMessage(c, 200, '用户已删除');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
