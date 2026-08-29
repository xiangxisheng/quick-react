import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { allSql } from '@server/database/sql.mjs';
import { sql } from '@server/database/sql.mjs';

const columns = [
	{ dataIndex: 'user_id', title: 'ID', dataType: 'text' as const },
	{ dataIndex: 'nickname', title: '昵称' },
	{ dataIndex: 'status', title: '状态' },
	{ dataIndex: 'created_at', title: '创建时间', dataType: 'js_timestamp' as const, dayjsFormat: 'YYYY-MM-DD HH:mm:ss' },
	{ dataIndex: 'updated_at', title: '更新时间', dataType: 'js_timestamp' as const, dayjsFormat: 'YYYY-MM-DD HH:mm:ss' },
];

const handler: ApiHandler = async (c, next) => {
	if (c.req.method !== 'GET') return next();
	const database = c.get('passportDatabase');
	if (!database) return apiMessage(c, 503, 'Accounts 数据库不可用');
	const rows = await allSql(database, sql(database).select({ table: 'passport_users', columns: { user_id: { column: 'user_id', cast: 'text' }, nickname: 'nickname', status: 'status', created_at: 'created_at', updated_at: 'updated_at' }, orderBy: [{ column: 'created_at', direction: 'DESC' }] }));
	return apiResponse(c, 200, { table: { option: { rowKey: 'user_id' }, columns, dataSource: rows, totalRecords: rows.length } });
};

export default handler;
