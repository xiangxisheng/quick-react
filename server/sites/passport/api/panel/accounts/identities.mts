import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { listAccountIdentities, unbindAccountIdentity } from '@server/passport/account.mjs';

const kindOptions = [
	{ value: 'external', text: '第三方账号', color: 'blue' },
	{ value: 'telegram', text: 'Telegram', color: 'cyan' },
];

const columns = [
	{ dataIndex: 'provider_label', title: '身份来源' },
	{ dataIndex: 'kind', title: '类型', component: 'select' as const, options: kindOptions },
	{ dataIndex: 'detail', title: '账号标识' },
	{ dataIndex: 'created_at', title: '绑定时间', dataType: 'js_timestamp' as const, dayjsFormat: 'YYYY-MM-DD HH:mm:ss' },
];

const handler: ApiHandler = async (c, _next, params) => {
	const database = c.get('passportDatabase')!, globalDatabase = c.get('globalDatabase');
	const userId = String(c.get('passportUser')!.id);

	if (c.req.method === 'GET' && !params.id) {
		const identities = await listAccountIdentities(database, globalDatabase, userId);
		return apiResponse(c, 200, {
			table: {
				option: {
					rowKey: 'identity_key',
					// 绑定新身份需要跳转到身份源授权，放在“绑定身份”页面完成。
					actions: { row: [{ key: 'delete', label: '解绑', confirm: '解绑后将不能再用该身份登录，确认解绑？' }] },
				},
				columns,
				dataSource: identities,
				totalRecords: identities.length,
			},
		});
	}

	if (c.req.method === 'DELETE' && !params.id) {
		const ids = await c.req.json<unknown>().catch(() => []);
		const targets = Array.isArray(ids) ? ids.map((value) => String(value)) : [];
		if (!targets.length) return apiMessage(c, 400, '请选择要解绑的身份');
		const removed: string[] = [];
		for (const target of targets) {
			try { removed.push(await unbindAccountIdentity(database, globalDatabase, userId, target)); }
			catch (error) { return apiMessage(c, 409, error instanceof Error ? error.message : '解绑失败'); }
		}
		return apiMessage(c, 200, `${removed.join('、')} 已解绑`);
	}

	return apiMessage(c, 405, '不支持的请求方法');
};

export const acceptsTrailingParams = true;
export default handler;
