import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { parseRedirectUris, randomToken, sha256 } from '@server/accounts/oidc.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';
import { allSql, runSql, sql } from '@server/database/sql.mjs';
import { oidcClients } from '@server/accounts/repository.mjs';

const defaultBackchannelLogoutPath = '/api/accounts/oidc/backchannel-logout';

const columns = [
	{ dataIndex: 'id', title: '客户端 ID' },
	{ dataIndex: 'name', title: '名称', component: 'textbox', rules: [{ required: true, message: '请输入客户端名称' }] },
	{ dataIndex: 'redirect_uris', title: '回调地址', component: 'select', multiple: true, allowCustomValue: true, placeholder: '选择业务站点域名，或输入完整 HTTPS 回调地址后回车', tableDisplay: 'multiline' as const, rules: [{ required: true, message: '请选择或输入至少一个回调地址' }] },
	{ dataIndex: 'backchannel_logout_path', title: '后端注销路径', component: 'textbox', placeholder: defaultBackchannelLogoutPath, rules: [{ required: true, message: '请输入注销路径' }] },
	{ dataIndex: 'allowed_scopes', title: '允许 Scope', component: 'textbox' },
	{ dataIndex: 'require_pkce', title: '要求 PKCE', component: 'switch' },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
];

const loadRedirectUriOptions = async (c: Parameters<ApiHandler>[0]) => {
	const database = c.get('globalDatabase');
	const rows = await allSql<{ hostname: string; site_key: string; site_name: string }>(database, sql(database).select({
		table: 'global_site_hosts', alias: 'h',
		columns: { hostname: 'h.hostname', site_key: 'h.site_key', site_name: 's.name' },
		joins: [{ table: 'global_sites', alias: 's', left: 's.site_key', right: 'h.site_key' }],
		where: [{ column: 'h.status', value: 'enabled' }, { column: 's.status', value: 'enabled' }, { column: 's.migration_status', value: 'ready' }],
		orderBy: [{ column: 'h.hostname' }],
	}));
	return rows
		.filter((row) => row.site_key !== 'global' && row.site_key !== 'passport' && !row.hostname.startsWith('*.'))
		.map((row) => {
			const origin = `https://${row.hostname}`;
			return { value: `${origin}/api/accounts/oidc/callback`, text: `${row.site_name} (${row.hostname})`, fieldValues: { backchannel_logout_path: defaultBackchannelLogoutPath } };
		});
};

const normalizeBackchannelPath = (value: unknown) => {
		const path = String(value ?? '').trim() || defaultBackchannelLogoutPath;
		if (!path.startsWith('/') || path.startsWith('//') || path.includes('#') || path.includes('://')) throw new Error('注销地址必须是以 / 开头的路径，不能填写完整域名');
		return path;
};

const backchannelUri = (redirectUris: string[], path: string) => {
	const origin = new URL(redirectUris[0]).origin;
	return `${origin}${path}`;
};

const pathFromUri = (value: unknown) => {
	try { const url = new URL(String(value ?? '')); return `${url.pathname}${url.search}` || defaultBackchannelLogoutPath; }
	catch { return defaultBackchannelLogoutPath; }
};

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('passportDatabase');
	if (!database || c.get('site').siteKey !== 'passport') return apiMessage(c, 404);
	if (!params.id && c.req.method === 'GET') {
		const rows: Array<Record<string, unknown>> = await oidcClients(database);
		for (const row of rows) {
			row.redirect_uris = JSON.parse(String(row.redirect_uris || '[]'));
			row.backchannel_logout_path = pathFromUri(row.backchannel_logout_uri);
			delete row.backchannel_logout_uri;
		}
		const redirectUriOptions = await loadRedirectUriOptions(c);
		const tableColumns = columns.map((column) => column.dataIndex === 'redirect_uris' ? { ...column, options: redirectUriOptions } : column);
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { toolbar: [{ key: 'create', label: '新增客户端' }], row: [{ key: 'edit', label: '编辑' }, { key: 'reset-secret', label: '重置密钥', confirm: '重置后旧密钥立即失效，确定继续吗？' }, { key: 'delete', label: '删除' }] } }, columns: tableColumns, dataSource: rows, totalRecords: rows.length } });
	}
	if (!params.id && c.req.method === 'POST') {
		const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
		let redirectUris: string[];
		try { redirectUris = parseRedirectUris(body.redirect_uris); } catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '回调地址不合法'); }
		let logoutPath: string;
		try { logoutPath = normalizeBackchannelPath(body.backchannel_logout_path); } catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '注销路径不合法'); }
		const name = String(body.name ?? '').trim(), id = `acct_${randomToken(18)}`, secret = randomToken(36), now = Date.now();
		if (!name) return apiMessage(c, 400, '请输入客户端名称');
		await runSql(database, sql(database).insert('passport_oidc_clients', { id, name, secret_hash: await sha256(secret), redirect_uris: JSON.stringify(redirectUris), backchannel_logout_uri: backchannelUri(redirectUris, logoutPath), allowed_scopes: String(body.allowed_scopes ?? 'openid profile email').trim() || 'openid', require_pkce: body.require_pkce === false ? 0 : 1, status: 'enabled', created_at: now, updated_at: now }));
		return apiMessageData(c, 201, `客户端已创建。客户端密钥仅显示一次：${secret}`, { id, client_secret: secret });
	}
	if (params.id && c.req.method === 'PUT') {
		const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
		let redirectUris: string[];
		try { redirectUris = parseRedirectUris(body.redirect_uris); } catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '回调地址不合法'); }
		let logoutPath: string;
		try { logoutPath = normalizeBackchannelPath(body.backchannel_logout_path); } catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '注销路径不合法'); }
		const updated = await runSql(database, sql(database).update('passport_oidc_clients', { name: String(body.name ?? '').trim(), redirect_uris: JSON.stringify(redirectUris), backchannel_logout_uri: backchannelUri(redirectUris, logoutPath), allowed_scopes: String(body.allowed_scopes ?? 'openid').trim(), require_pkce: body.require_pkce === false ? 0 : 1, status: body.status === 'disabled' ? 'disabled' : 'enabled', updated_at: Date.now() }, { id: params.id }));
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
