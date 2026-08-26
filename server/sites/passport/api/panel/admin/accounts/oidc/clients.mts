import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { parseRedirectUris, randomToken, sha256 } from '@server/accounts/oidc.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';
import { runSql, sql } from '@server/database/sql.mjs';
import { oidcClients } from '@server/accounts/repository.mjs';

const columns = [
	{ dataIndex: 'id', title: '客户端 ID', component: 'textbox' },
	{ dataIndex: 'name', title: '名称', component: 'textbox', rules: [{ required: true, message: '请输入客户端名称' }] },
	{ dataIndex: 'redirect_uris', title: '回调地址', component: 'textarea', tableDisplay: 'multiline' as const, rules: [{ required: true, message: '请输入回调地址' }] },
	{ dataIndex: 'backchannel_logout_uri', title: '后端注销地址', component: 'url', placeholder: 'https://site.example/api/accounts/oidc/backchannel-logout' },
	{ dataIndex: 'allowed_scopes', title: '允许 Scope', component: 'textbox' },
	{ dataIndex: 'require_pkce', title: '要求 PKCE', component: 'switch' },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
];

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('passportDatabase');
	if (!database || c.get('site').siteKey !== 'passport') return apiMessage(c, 404);
	if (!params.id && c.req.method === 'GET') {
		const rows: Array<Record<string, unknown>> = await oidcClients(database);
		for (const row of rows) row.redirect_uris = JSON.parse(String(row.redirect_uris || '[]')).join('\n');
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { toolbar: [{ key: 'create', label: '新增客户端' }], row: [{ key: 'edit', label: '编辑' }, { key: 'reset-secret', label: '重置密钥', confirm: '重置后旧密钥立即失效，确定继续吗？' }, { key: 'delete', label: '删除' }] } }, columns, dataSource: rows, totalRecords: rows.length } });
	}
	if (!params.id && c.req.method === 'POST') {
		const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
		let redirectUris: string[];
		try { redirectUris = parseRedirectUris(body.redirect_uris); } catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '回调地址不合法'); }
		const name = String(body.name ?? '').trim(), id = `acct_${randomToken(18)}`, secret = randomToken(36), now = Date.now();
		if (!name) return apiMessage(c, 400, '请输入客户端名称');
		await runSql(database, sql(database).insert('passport_oidc_clients', { id, name, secret_hash: await sha256(secret), redirect_uris: JSON.stringify(redirectUris), backchannel_logout_uri: String(body.backchannel_logout_uri ?? '').trim(), allowed_scopes: String(body.allowed_scopes ?? 'openid profile email').trim() || 'openid', require_pkce: body.require_pkce === false ? 0 : 1, status: 'enabled', created_at: now, updated_at: now }));
		return apiMessageData(c, 201, `客户端已创建。客户端密钥仅显示一次：${secret}`, { id, client_secret: secret });
	}
	if (params.id && c.req.method === 'PUT') {
		const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
		let redirectUris: string[];
		try { redirectUris = parseRedirectUris(body.redirect_uris); } catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '回调地址不合法'); }
		const updated = await runSql(database, sql(database).update('passport_oidc_clients', { name: String(body.name ?? '').trim(), redirect_uris: JSON.stringify(redirectUris), backchannel_logout_uri: String(body.backchannel_logout_uri ?? '').trim(), allowed_scopes: String(body.allowed_scopes ?? 'openid').trim(), require_pkce: body.require_pkce === false ? 0 : 1, status: body.status === 'disabled' ? 'disabled' : 'enabled', updated_at: Date.now() }, { id: params.id }));
		return Number(updated.meta?.changes ?? 0) ? apiMessage(c, 200, '保存成功') : apiMessage(c, 404, 'OIDC 客户端不存在');
	}
	if (params.id && c.req.method === 'POST') {
		const secret = randomToken(36);
		const updated = await runSql(database, sql(database).update('passport_oidc_clients', { secret_hash: await sha256(secret), updated_at: Date.now() }, { id: params.id }));
		return Number(updated.meta?.changes ?? 0) ? apiMessageData(c, 200, `密钥已重置，仅显示一次：${secret}`, { client_secret: secret }) : apiMessage(c, 404, 'OIDC 客户端不存在');
	}
	if (params.id && c.req.method === 'DELETE') {
		await runSql(database, sql(database).delete('passport_oidc_clients', { id: params.id }));
		return apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
