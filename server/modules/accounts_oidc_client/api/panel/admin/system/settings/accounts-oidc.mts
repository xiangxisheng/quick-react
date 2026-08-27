import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { accountsOidcConfigKey, defaultAccountsOidcConfig, normalizeAccountsOidcConfig } from '@server/accounts/client.mjs';
import type { FormPageConfig } from '@shared/types/form-page.mjs';
import { allSql, sql } from '@server/database/sql.mjs';

const defaultIssuer = 'https://accounts.example.com';
const createFormPage = (issuerOptions: Array<{ value: string; text: string; fieldValues?: Record<string, unknown> }>): FormPageConfig => ({
	description: '业务站点通过 OIDC Authorization Code + PKCE 登录 Accounts。客户端密钥保存在本站数据库，不会写入全局站点库。',
	submitLabel: '保存配置', initialValues: defaultAccountsOidcConfig,
	fields: [
		{ name: 'enabled', label: '启用 Accounts 登录', type: 'switch' },
		{ name: 'issuerSource', label: 'Passport 域名', type: 'select', options: issuerOptions, placeholder: '选择 Passport 域名，或选择自定义', rules: [{ required: true, message: '请选择 Passport 域名来源' }] },
		{ name: 'issuer', label: 'Accounts Issuer', type: 'text', placeholder: 'https://accounts.example.com', readOnlyWhen: { field: 'issuerSource', optionValues: true }, rules: [{ required: true, message: '请输入 Accounts Issuer' }] },
		{ name: 'clientId', label: '客户端 ID', type: 'text', rules: [{ required: true, message: '请输入客户端 ID' }] },
		{ name: 'clientSecret', label: '客户端密钥', type: 'password', extra: '留空表示保留现有密钥；创建或重置 OIDC 客户端后只显示一次。' },
	],
});

const loadIssuerOptions = async (c: Parameters<ApiHandler>[0], currentIssuer: string) => {
	const database = c.get('globalDatabase');
	const rows = await allSql<{ hostname: string }>(database, sql(database).select({
		table: 'global_site_hosts', alias: 'h',
		columns: { hostname: 'h.hostname' },
		joins: [{ table: 'global_sites', alias: 's', left: 's.site_key', right: 'h.site_key' }],
		where: [{ column: 'h.site_key', value: 'passport' }, { column: 'h.status', value: 'enabled' }, { column: 's.status', value: 'enabled' }, { column: 's.migration_status', value: 'ready' }],
		orderBy: [{ column: 'h.hostname' }],
	}));
	const options: Array<{ value: string; text: string; fieldValues?: Record<string, unknown> }> = rows.filter((row) => !row.hostname.startsWith('*.')).map((row) => ({ value: `https://${row.hostname}`, text: `Passport (${row.hostname})`, fieldValues: { issuer: `https://${row.hostname}` } }));
	if (!options.length && !currentIssuer) options.push({ value: defaultIssuer, text: defaultIssuer, fieldValues: { issuer: defaultIssuer } });
	options.push({ value: '__custom__', text: '自定义 Issuer' });
	return options;
};

const handler: ApiHandler = async (c, next) => {
	const store = c.get('configStore'), current = normalizeAccountsOidcConfig(await store.get(accountsOidcConfigKey));
	if (c.req.method === 'GET') {
		const issuerOptions = await loadIssuerOptions(c, current.issuer);
		const issuerSource = issuerOptions.some((option) => option.value === current.issuer) ? current.issuer : '__custom__';
		return apiResponse(c, 200, { currentValues: { ...current, issuerSource, clientSecret: '' }, formPage: { ...createFormPage(issuerOptions), initialValues: { ...current, issuerSource, clientSecret: '' } } });
	}
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
