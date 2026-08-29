import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiMessage, apiResponse } from '@server/modules/base/api-response.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';
import { readPassportSessionId } from '@server/passport/session.mjs';

const columns = [
	{ dataIndex: 'device', title: '设备' },
	{ dataIndex: 'platform', title: '平台' },
	{ dataIndex: 'ip_address', title: '最近 IP' },
	{ dataIndex: 'last_seen_at', title: '最近活动', dataType: 'js_timestamp' as const, dayjsFormat: 'YYYY-MM-DD HH:mm:ss' },
	{ dataIndex: 'created_at', title: '首次登录', dataType: 'js_timestamp' as const, dayjsFormat: 'YYYY-MM-DD HH:mm:ss' },
	{ dataIndex: 'status', title: '状态' },
];

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('passportDatabase');
	if (!database) return apiMessage(c, 503, 'Accounts 数据库不可用');
	const userId = String(c.get('passportUser')!.id);
	if (c.req.method === 'GET' && !params.id) {
		const currentSessionId = readPassportSessionId(c.req.raw);
		const current = currentSessionId ? await firstSql<{ device_id: string | null }>(database, sql(database).select({ table: 'passport_sessions', columns: { device_id: 'device_id' }, where: [{ column: 'id', value: currentSessionId }, { column: 'user_id', value: userId }] })) : undefined;
		const devices = await allSql<any>(database, sql(database).select({
			table: 'passport_devices', alias: 'd',
			columns: { id: 'd.id', device: 'd.user_agent', platform: 'd.platform', ip_address: 'd.ip_address', status: 'd.status', created_at: 'd.created_at', last_seen_at: 'd.last_seen_at', current: 'd.id' },
			where: [{ column: 'd.user_id', value: userId }], orderBy: [{ column: 'd.last_seen_at', direction: 'DESC' }],
		}));
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { row: [{ key: 'delete', label: '注销设备', confirm: '注销后该设备上的 Accounts 会话将立即失效，确认注销？' }] } }, columns, dataSource: devices.map((device) => ({ ...device, device: `${device.device || '未知浏览器'}${device.id === current?.device_id ? '（当前设备）' : ''}`, status: device.status === 'active' ? '正常' : '已注销' })), totalRecords: devices.length } });
	}
	if (c.req.method === 'DELETE') {
		const raw = params.id ? [params.id] : await c.req.json<unknown>().catch(() => []);
		const ids = Array.isArray(raw) ? raw.map(String) : [String(raw)];
		if (!ids.length || ids.some((id) => !id)) return apiMessage(c, 400, '请选择要注销的设备');
		for (const id of ids) {
			const device = await firstSql<{ id: string }>(database, sql(database).select({ table: 'passport_devices', columns: { id: 'id' }, where: [{ column: 'id', value: id }, { column: 'user_id', value: userId }, { column: 'status', value: 'active' }] }));
			if (!device) return apiMessage(c, 404, '设备不存在或已经注销');
			await runSql(database, sql(database).update('passport_devices', { status: 'revoked', revoked_at: Date.now() }, { id: device.id, user_id: userId }));
			await runSql(database, sql(database).delete('passport_sessions', { device_id: device.id }));
		}
		return apiMessage(c, 200, '设备已注销');
	}
	return next();
};

export default handler;
