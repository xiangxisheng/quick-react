import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiMessage, apiResponse } from '@server/modules/base/api-response.mjs';
import { readStoredPassword } from '@server/modules/base/auth/index.mjs';
import { allSql, sql } from '@server/database/sql.mjs';
import { setPassportPassword } from '@server/modules/passport/identity.mjs';

const columns = [
	{ dataIndex: 'user_id', title: 'ID', dataType: 'text' as const },
	{ dataIndex: 'nickname', title: '昵称' },
	{ dataIndex: 'password', title: '密码特征' },
	{ dataIndex: 'status', title: '状态' },
	{ dataIndex: 'created_at', title: '创建时间', dataType: 'js_timestamp' as const, dayjsFormat: 'YYYY-MM-DD HH:mm:ss' },
	{ dataIndex: 'updated_at', title: '更新时间', dataType: 'js_timestamp' as const, dayjsFormat: 'YYYY-MM-DD HH:mm:ss' },
];
const passwordResetColumns = [{ dataIndex: 'password', title: '新密码', component: 'textbox' as const, inputType: 'password' as const, placeholder: '至少 8 个字符', rules: [{ required: true, message: '请输入新密码' }] }];

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('passportDatabase');
	if (!database) return apiMessage(c, 503, 'Accounts 数据库不可用');
	if (params.id && c.req.method === 'POST' && c.req.query('action') === 'reset-password') {
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
		try { await setPassportPassword(database, params.id, String(body.password ?? '')); }
		catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '密码设置失败'); }
		return apiMessage(c, 200, '密码已重设');
	}
	if (c.req.method !== 'GET') return next();
	const rows = await allSql<Record<string, unknown>>(database, sql(database).select({ table: 'passport_users', columns: { user_id: { column: 'user_id', cast: 'text' }, nickname: 'nickname', status: 'status', created_at: 'created_at', updated_at: 'updated_at' }, orderBy: [{ column: 'created_at', direction: 'DESC' }] }));
	const credentials = await allSql<Record<string, unknown>>(database, sql(database).select({ table: 'passport_user_credentials', columns: { user_id: { column: 'user_id', cast: 'text' }, password: 'password', created_at: 'created_at' }, orderBy: [{ column: 'created_at', direction: 'DESC' }] }));
	const patterns = new Map<string, string>();
	for (const credential of credentials) {
		const userId = String(credential.user_id ?? '');
		if (!patterns.has(userId)) patterns.set(userId, readStoredPassword(credential.password)?.pattern ?? '');
	}
	const dataSource = rows.map((row) => ({ ...row, password: patterns.get(String(row.user_id)) ?? '' }));
	return apiResponse(c, 200, { table: { option: { rowKey: 'user_id', actions: { row: [{ key: 'reset-password', label: '重设密码', form: { columns: passwordResetColumns } }] } }, columns, dataSource, totalRecords: dataSource.length } });
};

export const acceptsTrailingParams = true;
export default handler;
