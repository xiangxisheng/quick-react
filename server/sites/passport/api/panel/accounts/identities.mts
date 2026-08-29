import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiMessage, apiResponse } from '@server/modules/base/api-response.mjs';
import { listAccountIdentities, unbindAccountIdentity } from '@server/passport/account.mjs';
import { bindReturnCookie, externalProviders } from '@server/accounts/external.mjs';
import { isSecureRequest } from '@server/modules/base/request-origin.mjs';

const columns = [
	{ dataIndex: 'provider_label', title: '身份来源' },
	{ dataIndex: 'nickname', title: '昵称', component: 'avatar_text' as const },
	{ dataIndex: 'detail', title: '账号标识' },
	{ dataIndex: 'created_at', title: '绑定时间', dataType: 'js_timestamp' as const, dayjsFormat: 'YYYY-MM-DD HH:mm:ss' },
];

const handler: ApiHandler = async (c, _next, params) => {
	const database = c.get('passportDatabase')!, globalDatabase = c.get('globalDatabase');
	const userId = String(c.get('passportUser')!.id);

	if (c.req.method === 'GET' && !params.id) {
		const [identities, providers] = await Promise.all([
			listAccountIdentities(database, globalDatabase, userId),
			externalProviders(database, true),
		]);
		return apiResponse(c, 200, {
			table: {
				option: {
					rowKey: 'identity_key',
					actions: { toolbar: providers.map((provider) => ({ key: `bind:${provider.id}`, label: `绑定${provider.display_name}` })),
						row: [{ key: 'delete', label: '解绑', confirm: '确认解绑 {provider_label} 身份（{detail}）吗？解绑后将不能再使用这个账号登录。' }] },
				},
				columns,
				dataSource: identities,
				totalRecords: identities.length,
			},
		});
	}

	if ((c.req.method === 'POST' || c.req.method === 'PUT') && !params.id) {
		const action = c.req.query('action')?.trim() ?? '';
		if (action.startsWith('bind:')) {
			const provider = (await externalProviders(database, true)).find((item) => item.id === action.slice('bind:'.length));
			if (!provider) return apiMessage(c, 400, '外部身份源不存在或未启用');
			c.header('Set-Cookie', bindReturnCookie(`/panel/accounts/identities${c.get('techStackConfig').pageSuffix}`, isSecureRequest(c)));
			return apiResponse(c, 200, { redirectTo: `/api/accounts/external/${provider.id}`, openWindow: true });
		}
		if (action) return apiMessage(c, 400, '不支持的操作');
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
