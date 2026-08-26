import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';

type ProviderId = 'google' | 'wechat';
type ProviderRow = { id: ProviderId; display_name: string; client_id: string; client_secret: string; status: string; created_at: number; updated_at: number };

const providerOptions = [
	{ value: 'google', text: 'Google' },
	{ value: 'wechat', text: '微信开放平台' },
];
const columns = [
	{ dataIndex: 'id', title: 'ID', component: 'select', options: providerOptions, rules: [{ required: true, message: '请选择身份源' }] },
	{ dataIndex: 'display_name', title: '显示名称', component: 'textbox', rules: [{ required: true, message: '请输入显示名称' }] },
	{ dataIndex: 'client_id', title: '客户端 ID / AppID', component: 'textbox', rules: [{ required: true, message: '请输入客户端 ID 或 AppID' }] },
	{ dataIndex: 'client_secret', title: '客户端密钥 / AppSecret', component: 'textbox', inputType: 'password', placeholder: '编辑时留空表示保留现有密钥' },
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
		const rows = await allSql<ProviderRow>(database, sql(database).select({ table: 'passport_external_providers', columns: { id: 'id', display_name: 'display_name', client_id: 'client_id', client_secret: 'client_secret', status: 'status', created_at: 'created_at', updated_at: 'updated_at' }, orderBy: [{ column: 'created_at' }] }));
		const origin = c.get('systemConfig').publicOrigin?.trim() || new URL(c.req.url).origin;
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { toolbar: [{ key: 'create', label: '新增身份源' }], row: [{ key: 'edit', label: '编辑' }, { key: 'delete', label: '删除', confirm: '只能删除已停用且从未产生授权历史的身份源，确定继续吗？' }] } }, columns, dataSource: rows.map((row) => ({ ...row, client_secret: '', secret_configured: row.client_secret ? '已配置' : '未配置', callback_url: new URL(`/api/accounts/external/${row.id}`, origin).toString() })), totalRecords: rows.length } });
	}
	if (!params.id && c.req.method === 'POST') {
		const body = await parseBody(c);
		const id = providerId(body.id), displayName = requiredText(body.display_name), clientId = requiredText(body.client_id), clientSecret = requiredText(body.client_secret);
		if (!id) return apiMessage(c, 400, '身份源只能选择 Google 或微信开放平台');
		if (!displayName) return apiMessage(c, 400, '请输入显示名称');
		if (!clientId) return apiMessage(c, 400, id === 'wechat' ? '请输入微信 AppID' : '请输入 Google Client ID');
		if (!clientSecret) return apiMessage(c, 400, id === 'wechat' ? '请输入微信 AppSecret' : '请输入 Google Client Secret');
		const exists = await firstSql(database, sql(database).select({ table: 'passport_external_providers', columns: { id: 'id' }, where: [{ column: 'id', value: id }] }));
		if (exists) return apiMessage(c, 409, `${id === 'google' ? 'Google' : '微信'}身份源已经存在，请直接编辑`);
		const now = Date.now();
		await runSql(database, sql(database).insert('passport_external_providers', { id, display_name: displayName, client_id: clientId, client_secret: clientSecret, status: body.status === 'disabled' ? 'disabled' : 'enabled', created_at: now, updated_at: now }));
		return apiMessage(c, 201, '外部身份源已创建');
	}
	const id = providerId(params.id);
	if (!id) return apiMessage(c, 404, '外部身份源不存在');
	if (c.req.method === 'PUT') {
		const body = await parseBody(c);
		if (body.id !== undefined && body.id !== id) return apiMessage(c, 400, '身份源 ID 创建后不能修改');
		const displayName = requiredText(body.display_name), clientId = requiredText(body.client_id), clientSecret = requiredText(body.client_secret);
		if (!displayName || !clientId) return apiMessage(c, 400, '显示名称和客户端 ID 不能为空');
		const updated = await runSql(database, sql(database).update('passport_external_providers', { display_name: displayName, client_id: clientId, client_secret: clientSecret || undefined, status: body.status === 'disabled' ? 'disabled' : 'enabled', updated_at: Date.now() }, { id }));
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
