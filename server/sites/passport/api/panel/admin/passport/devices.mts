import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { allSql, runSql, sql } from '@server/database/sql.mjs';

const columns = [
	{ dataIndex: 'id', title: 'ID' },
	{ dataIndex: 'user_id', title: '用户 ID', dataType: 'text' as const },
	{ dataIndex: 'device', title: '设备' },
	{ dataIndex: 'platform', title: '平台' },
	{ dataIndex: 'ip_address', title: '最近 IP' },
	{ dataIndex: 'last_seen_at', title: '最近活动', dataType: 'js_timestamp' as const, dayjsFormat: 'YYYY-MM-DD HH:mm:ss' },
	{ dataIndex: 'status', title: '状态' },
];

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('passportDatabase');
	if (!database) return apiMessage(c, 503, 'Accounts 数据库不可用');
	if (c.req.method === 'GET' && !params.id) {
		const rows = await allSql<Record<string, unknown>>(database, sql(database).select({ table: 'passport_devices', columns: { id: 'id', user_id: { column: 'user_id', cast: 'text' }, device: 'user_agent', platform: 'platform', ip_address: 'ip_address', last_seen_at: 'last_seen_at', status: 'status' }, orderBy: [{ column: 'last_seen_at', direction: 'DESC' }] }));
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { row: [{ key: 'delete', label: '注销设备', confirm: '注销后该设备的所有 Passport 会话将立即失效，确认注销？' }] } }, columns, dataSource: rows.map((row) => ({ ...row, device: String(row.device || '未知浏览器'), status: row.status === 'active' ? '正常' : '已注销' })), totalRecords: rows.length } });
	}
	if (c.req.method === 'DELETE') {
		const ids = params.id ? [params.id] : await c.req.json<unknown>().then((value) => Array.isArray(value) ? value.map(String) : []).catch(() => []);
		if (!ids.length) return apiMessage(c, 400, '请选择要注销的设备');
		for (const id of ids) {
			await runSql(database, sql(database).update('passport_devices', { status: 'revoked', revoked_at: Date.now() }, { id, status: 'active' }));
			await runSql(database, sql(database).delete('passport_sessions', { device_id: id }));
		}
		return apiMessage(c, 200, '设备已注销');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
