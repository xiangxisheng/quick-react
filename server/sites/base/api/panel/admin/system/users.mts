import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { createStoredPassword, readStoredPassword } from '@server/auth.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';

const columns = [
	{ dataIndex: 'id', title: 'ID', dataType: 'int' as const },
	{ dataIndex: 'username', title: '用户名', component: 'textbox' as const },
	{ dataIndex: 'password', title: '新密码', component: 'textbox' as const, inputType: 'password' as const, placeholder: '留空表示不修改' },
	{ dataIndex: 'roles', title: '角色', component: 'textbox' as const },
	{ dataIndex: 'status', title: '状态', component: 'switch' as const, checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
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
		const rows = await allSql<Record<string, unknown>>(database, sql(database).select({ table: 'base_system_users', columns: { id: 'id', username: 'username', roles: 'roles', status: 'status', password: 'password', created_at: 'created_at', updated_at: 'updated_at' }, orderBy: [{ column: 'id', direction: 'DESC' }] }));
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'create', label: '新增' }, { key: 'delete', label: '删除' }], row: [{ key: 'edit', label: '编辑' }, { key: 'delete', label: '删除' }] } }, columns, dataSource: rows.map(publicUser), totalRecords: rows.length } });
	}
	if (params.id && c.req.method === 'GET') {
		const row = await firstSql<Record<string, unknown>>(database, sql(database).select({ table: 'base_system_users', columns: { id: 'id', username: 'username', roles: 'roles', status: 'status', password: 'password', created_at: 'created_at', updated_at: 'updated_at' }, where: [{ column: 'id', value: params.id }] }));
		return row ? apiResponse(c, 200, publicUser(row)) : apiMessage(c, 404, '用户不存在');
	}
	if (!params.id && c.req.method === 'POST') {
		const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
		const username = String(body.username ?? '').trim();
		const password = String(body.password ?? '');
		if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username) || password.length < 8) return apiMessage(c, 400, '用户名至少 3 个合法字符，密码至少 8 个字符');
		const now = Date.now();
		try {
			await runSql(database, sql(database).insert('base_system_users', { username, password: await createStoredPassword(password), roles: String(body.roles ?? '["user"]'), status: String(body.status ?? 'enabled'), created_at: now, updated_at: now }));
			const created = await firstSql<{ id: number | string }>(database, sql(database).select({ table: 'base_system_users', columns: { id: 'id' }, where: [{ column: 'username', value: username }] }));
			return apiMessageData(c, 201, '用户已创建', { id: created?.id, username });
		} catch {
			return apiMessage(c, 409, '用户名已存在');
		}
	}
	if (params.id && c.req.method === 'PUT') {
		const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
		const current = await firstSql<{ id: number }>(database, sql(database).select({ table: 'base_system_users', columns: { id: 'id' }, where: [{ column: 'id', value: params.id }] }));
		if (!current) return apiMessage(c, 404, '用户不存在');
		const changedFields = getChangedFields(body, ['username', 'roles', 'status', 'password']);
		const values: Record<string, unknown> = {};
		for (const key of ['username', 'roles', 'status']) {
			if (changedFields.has(key)) values[key] = String(body[key] ?? '');
		}
		const password = String(body.password ?? '');
		if (changedFields.has('password') && password) {
			values.password = await createStoredPassword(password);
		}
		if (!Object.keys(values).length) return apiMessage(c, 400, '没有可修改的字段');
		values.updated_at = Date.now();
		try {
			await runSql(database, sql(database).update('base_system_users', values, { id: params.id }));
			return apiMessage(c, 200, '用户已保存');
		} catch { return apiMessage(c, 409, '用户名已存在'); }
	}
	if (params.id && c.req.method === 'DELETE') {
		await runSql(database, sql(database).delete('base_system_users', { id: params.id }));
		return apiMessage(c, 200, '用户已删除');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
