import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { accountsOidcConfigKey, defaultAccountsOidcConfig, normalizeAccountsOidcConfig } from '@server/accounts/client.mjs';
import type { FormPageConfig } from '@shared/types/form-page.mjs';

const formPage = {
	description: '业务站点通过 OIDC Authorization Code + PKCE 登录 Accounts。客户端密钥保存在本站数据库，不会写入全局站点库。',
	submitLabel: '保存配置', initialValues: defaultAccountsOidcConfig,
	fields: [
		{ name: 'enabled', label: '启用 Accounts 登录', type: 'switch' },
		{ name: 'issuer', label: 'Accounts Issuer', type: 'text', placeholder: 'https://accounts.example.com', rules: [{ required: true, message: '请输入 Accounts Issuer' }] },
		{ name: 'clientId', label: '客户端 ID', type: 'text', rules: [{ required: true, message: '请输入客户端 ID' }] },
		{ name: 'clientSecret', label: '客户端密钥', type: 'password', extra: '留空表示保留现有密钥；创建或重置 OIDC 客户端后只显示一次。' },
	],
} satisfies FormPageConfig;

const handler: ApiHandler = async (c, next) => {
	const store = c.get('configStore'), current = normalizeAccountsOidcConfig(await store.get(accountsOidcConfigKey));
	if (c.req.method === 'GET') return apiResponse(c, 200, { currentValues: { ...current, clientSecret: '' }, formPage: { ...formPage, initialValues: { ...current, clientSecret: '' } } });
	if (c.req.method === 'PUT') {
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
		const config = normalizeAccountsOidcConfig(body, current);
		if (config.enabled && (!config.issuer || !config.clientId || !config.clientSecret)) return apiMessage(c, 400, '启用 Accounts 登录前必须填写有效 Issuer、客户端 ID 和客户端密钥');
		await store.put(accountsOidcConfigKey, config);
		return apiMessageData(c, 200, 'Accounts OIDC 配置已保存', { currentValues: { ...config, clientSecret: '' } });
	}
	return next();
};
export default handler;
