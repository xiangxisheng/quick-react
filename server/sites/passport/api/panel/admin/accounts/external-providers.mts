import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';
import { requestOrigin } from '@server/request-origin.mjs';

type ProviderId = 'google' | 'wechat';
type WechatMode = 'open_platform' | 'official_account';
type ProviderRow = { id: ProviderId; display_name: string; client_id: string; client_secret: string; wechat_mode: WechatMode; wechat_redirect_domain: string; status: string; created_at: number; updated_at: number };

const providerOptions = [
	{ value: 'google', text: 'Google' },
	{ value: 'wechat', text: '微信开放平台' },
];
const columns = [
	{ dataIndex: 'id', title: 'ID', component: 'select', options: providerOptions, rules: [{ required: true, message: '请选择身份源' }], form: { edit: false } },
	{ dataIndex: 'display_name', title: '显示名称', component: 'textbox', rules: [{ required: true, message: '请输入显示名称' }] },
	{ dataIndex: 'client_id', title: '客户端 ID / AppID', component: 'textbox', rules: [{ required: true, message: '请输入客户端 ID 或 AppID' }] },
	{ dataIndex: 'client_secret', title: 'Google Client Secret / 微信 AppSecret', component: 'textbox', inputType: 'password', hideInTable: true, placeholder: '留空表示保留现有密钥', form: { create: { placeholder: '请输入 Google Client Secret 或微信 AppSecret', rules: [{ required: true, message: '请输入 Google Client Secret 或微信 AppSecret' }] } } },
	{ dataIndex: 'wechat_mode', title: '微信登录类型', component: 'select', hideInTable: true, options: [{ value: 'open_platform', text: '开放平台网站应用（PC 扫码）' }, { value: 'official_account', text: '公众号服务号（微信内网页授权）' }], extra: '仅微信身份源生效；服务号使用 snsapi_userinfo，需在微信内打开。' },
	{ dataIndex: 'wechat_redirect_domain', title: '微信授权回调域名', component: 'textbox', hideInTable: true, placeholder: '例如 passport.firadio.com', extra: '仅填写域名，不要填写 https://、路径或查询参数；留空使用当前站点域名。' },
	{ dataIndex: 'secret_configured', title: '密钥状态' },
	{ dataIndex: 'callback_url', title: '授权回调地址' },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
];
const providerId = (value: unknown): ProviderId | undefined => value === 'google' || value === 'wechat' ? value : undefined;
const requiredText = (value: unknown) => String(value ?? '').trim();
const parseBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({}));

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('passportDatabase');
	if (!database || c.get('site').siteKey !== 'passport') return apiMessage(c, 404);
	if (!params.id && c.req.method === 'GET') {
		const rows = await allSql<ProviderRow>(database, sql(database).select({ table: 'passport_external_providers', columns: { id: 'id', display_name: 'display_name', client_id: 'client_id', client_secret: 'client_secret', wechat_mode: 'wechat_mode', wechat_redirect_domain: 'wechat_redirect_domain', status: 'status', created_at: 'created_at', updated_at: 'updated_at' }, orderBy: [{ column: 'created_at' }] }));
		const origin = c.get('systemConfig').publicOrigin?.trim() || requestOrigin(c);
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { toolbar: [{ key: 'create', label: '新增身份源' }], row: [{ key: 'edit', label: '编辑' }, { key: 'delete', label: '删除', confirm: '只能删除已停用且从未产生授权历史的身份源，确定继续吗？' }] } }, columns, dataSource: rows.map((row) => ({ ...row, client_secret: '', secret_configured: row.client_secret ? '已配置' : '未配置', callback_url: new URL(`/api/accounts/external/${row.id}`, origin).toString() })), totalRecords: rows.length } });
	}
	if (!params.id && c.req.method === 'POST') {
		const body = await parseBody(c);
		const id = providerId(body.id), displayName = requiredText(body.display_name), clientId = requiredText(body.client_id), clientSecret = requiredText(body.client_secret), wechatMode: WechatMode = body.wechat_mode === 'official_account' ? 'official_account' : 'open_platform', redirectDomain = requiredText(body.wechat_redirect_domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
		if (!id) return apiMessage(c, 400, '身份源只能选择 Google 或微信开放平台');
		if (!displayName) return apiMessage(c, 400, '请输入显示名称');
		if (!clientId) return apiMessage(c, 400, id === 'wechat' ? '请输入微信 AppID' : '请输入 Google Client ID');
		if (!clientSecret) return apiMessage(c, 400, id === 'wechat' ? '请输入微信 AppSecret' : '请输入 Google Client Secret');
		if (id === 'wechat' && redirectDomain && !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(redirectDomain)) return apiMessage(c, 400, '微信授权回调域名格式不正确，请只填写域名');
		const exists = await firstSql(database, sql(database).select({ table: 'passport_external_providers', columns: { id: 'id' }, where: [{ column: 'id', value: id }] }));
		if (exists) return apiMessage(c, 409, `${id === 'google' ? 'Google' : '微信'}身份源已经存在，请直接编辑`);
		const now = Date.now();
		await runSql(database, sql(database).insert('passport_external_providers', { id, display_name: displayName, client_id: clientId, client_secret: clientSecret, wechat_mode: wechatMode, wechat_redirect_domain: id === 'wechat' ? redirectDomain : '', status: body.status === 'disabled' ? 'disabled' : 'enabled', created_at: now, updated_at: now }));
		return apiMessage(c, 201, '外部身份源已创建');
	}
	const id = providerId(params.id);
	if (!id) return apiMessage(c, 404, '外部身份源不存在');
	if (c.req.method === 'GET') {
		const row = await firstSql<ProviderRow>(database, sql(database).select({ table: 'passport_external_providers', columns: { id: 'id', display_name: 'display_name', client_id: 'client_id', client_secret: 'client_secret', wechat_mode: 'wechat_mode', wechat_redirect_domain: 'wechat_redirect_domain', status: 'status', created_at: 'created_at', updated_at: 'updated_at' }, where: [{ column: 'id', value: id }] }));
		if (!row) return apiMessage(c, 404, '外部身份源不存在');
		const origin = c.get('systemConfig').publicOrigin?.trim() || requestOrigin(c);
		return apiResponse(c, 200, { ...row, client_secret: '', secret_configured: row.client_secret ? '已配置' : '未配置', callback_url: new URL(`/api/accounts/external/${row.id}`, origin).toString() });
	}
	if (c.req.method === 'PUT') {
		const body = await parseBody(c);
		if (body.id !== undefined && body.id !== id) return apiMessage(c, 400, '身份源 ID 创建后不能修改');
		const displayName = requiredText(body.display_name), clientId = requiredText(body.client_id), clientSecret = requiredText(body.client_secret), wechatMode: WechatMode = body.wechat_mode === 'official_account' ? 'official_account' : 'open_platform', redirectDomain = requiredText(body.wechat_redirect_domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
		if (!displayName || !clientId) return apiMessage(c, 400, '显示名称和客户端 ID 不能为空');
		if (id === 'wechat' && redirectDomain && !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(redirectDomain)) return apiMessage(c, 400, '微信授权回调域名格式不正确，请只填写域名');
		const updated = await runSql(database, sql(database).update('passport_external_providers', { display_name: displayName, client_id: clientId, client_secret: clientSecret || undefined, wechat_mode: wechatMode, wechat_redirect_domain: id === 'wechat' ? redirectDomain : '', status: body.status === 'disabled' ? 'disabled' : 'enabled', updated_at: Date.now() }, { id }));
		return Number(updated.meta?.changes ?? 0) ? apiMessage(c, 200, '外部身份源已保存') : apiMessage(c, 404, '外部身份源不存在');
	}
	if (c.req.method === 'DELETE') {
		const current = await firstSql<{ status: string }>(database, sql(database).select({ table: 'passport_external_providers', columns: { status: 'status' }, where: [{ column: 'id', value: id }] }));
		if (!current) return apiMessage(c, 404, '外部身份源不存在');
		if (current.status !== 'disabled') return apiMessage(c, 409, '外部身份源必须先停用才能删除');
		const [identity, authorization] = await Promise.all([
			firstSql(database, sql(database).select({ table: 'passport_external_identities', columns: { provider: 'provider' }, where: [{ column: 'provider', value: id }], limit: 1 })),
			firstSql(database, sql(database).select({ table: 'passport_external_login_states', columns: { provider: 'provider' }, where: [{ column: 'provider', value: id }], limit: 1 })),
		]);
		if (identity || authorization) return apiMessage(c, 409, '该身份源已有用户身份或授权历史，只能保持停用，不能删除');
		await runSql(database, sql(database).delete('passport_external_providers', { id }));
		return apiMessage(c, 200, '外部身份源已删除');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
