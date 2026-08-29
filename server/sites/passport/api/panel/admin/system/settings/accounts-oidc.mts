import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { accountsOidcConfigKey, normalizeAccountsOidcConfig } from '@server/accounts/client.mjs';
import type { FormPageConfig } from '@shared/types/form-page.mjs';

/**
 * 身份中心的账号登录设置：本站自己就是 Accounts，不需要填 Issuer 和客户端信息，
 * 只保留和其它站点相同的那个开关。
 */
const formPage: FormPageConfig = {
	description: '本站是 Accounts 账号中心，开启后登录页使用 Accounts 账号（邮箱、第三方身份）登录；关闭后登录页回到本站账号密码登录。',
	submitLabel: '保存配置',
	fields: [{ name: 'enabled', label: '启用 Accounts 登录', type: 'switch' }],
	initialValues: { enabled: false },
};

const handler: ApiHandler = async (c, next) => {
	const store = c.get('configStore');
	if (c.req.method === 'GET') {
		const currentValues = { enabled: c.get('accountsLoginMode') !== 'local' };
		return apiResponse(c, 200, { currentValues, formPage: { ...formPage, initialValues: currentValues } });
	}
	if (c.req.method === 'PUT') {
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
		const current = normalizeAccountsOidcConfig(await store.get(accountsOidcConfigKey));
		const config = { ...current, enabled: body.enabled === true };
		if (config.enabled && (!config.issuer || !config.clientId || !config.clientSecret)) return apiMessage(c, 400, '共享的 Accounts OIDC 配置不完整，请先填写 Issuer、客户端 ID 和客户端密钥');
		await store.put(accountsOidcConfigKey, config);
		return apiMessageData(c, 200, 'Accounts 登录配置已保存', { currentValues: { enabled: config.enabled } });
	}
	return next();
};
export default handler;
