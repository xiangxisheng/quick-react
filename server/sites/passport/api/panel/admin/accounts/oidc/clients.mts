import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { parseRedirectUris, randomToken, sha256 } from '@server/accounts/oidc.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';
import { allSql, runSql, sql } from '@server/database/sql.mjs';
import { oidcClient, oidcClients } from '@server/accounts/repository.mjs';

const defaultBackchannelLogoutPath = '/api/accounts/oidc/backchannel-logout';

const columns = [
	{ dataIndex: 'id', title: '客户端 ID' },
	{ dataIndex: 'name', title: '名称', component: 'textbox', rules: [{ required: true, message: '请输入客户端名称' }] },
	{ dataIndex: 'redirect_uri_source', title: '站点域名', component: 'select', hideInTable: true, placeholder: '选择站点域名或自定义' },
	{ dataIndex: 'redirect_uris', title: '回调地址', component: 'textbox', readOnlyWhen: { field: 'redirect_uri_source', optionValues: true }, placeholder: '完整 HTTPS 回调地址', rules: [{ required: true, message: '请输入回调地址' }] },
	{ dataIndex: 'backchannel_logout_path', title: '后端注销路径', component: 'textbox', readOnlyWhen: { field: 'redirect_uri_source', optionValues: true }, placeholder: defaultBackchannelLogoutPath, rules: [{ required: true, message: '请输入注销路径' }] },
	{ dataIndex: 'allowed_scopes', title: '允许 Scope', component: 'textbox' },
	{ dataIndex: 'require_pkce', title: '要求 PKCE', component: 'switch' },
	{ dataIndex: 'strict_redirect_uri', title: '严格校验回调地址', component: 'switch', extra: '关闭时自动允许同数据库已启用站点的标准回调；开启后只允许手工登记的完整地址。' },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
];

const loadRedirectUriOptions = async (c: Parameters<ApiHandler>[0]): Promise<Array<{ value: string; text: string; fieldValues: Record<string, unknown> }>> => {
	const database = c.get('globalDatabase');
	const rows = await allSql<{ hostname: string; site_key: string; site_name: string }>(database, sql(database).select({
		table: 'global_site_hosts', alias: 'h',
		columns: { hostname: 'h.hostname', site_key: 'h.site_key', site_name: 's.name' },
		joins: [{ table: 'global_sites', alias: 's', left: 's.site_key', right: 'h.site_key' }],
		where: [{ column: 'h.status', value: 'enabled' }, { column: 's.status', value: 'enabled' }, { column: 's.migration_status', value: 'ready' }],
		orderBy: [{ column: 'h.hostname' }],
	}));
	return rows
		.filter((row) => !row.hostname.startsWith('*.'))
		.map((row) => {
			const origin = `https://${row.hostname}`;
			return { value: `${origin}/api/accounts/oidc/callback`, text: `${row.site_name} (${row.hostname})`, fieldValues: { redirect_uris: `${origin}/api/accounts/oidc/callback`, backchannel_logout_path: defaultBackchannelLogoutPath } };
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

const clientFormRow = (row: Record<string, unknown>, options: Array<{ value: string }>) => {
	const redirectUris = JSON.parse(String(row.redirect_uris || '[]')) as string[];
	return {
		...row,
		redirect_uris: redirectUris.join(', '),
		backchannel_logout_path: pathFromUri(row.backchannel_logout_uri),
		redirect_uri_source: options.some((option) => option.value === redirectUris[0]) ? redirectUris[0] : '__custom__',
		backchannel_logout_uri: undefined,
	};
};

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('passportDatabase');
	if (!database) return apiMessage(c, 404);
	if (!params.id && c.req.method === 'GET') {
		const rows: Array<Record<string, unknown>> = await oidcClients(database);
		const redirectUriOptions = await loadRedirectUriOptions(c);
		const dataSource = rows.map((row) => clientFormRow(row, redirectUriOptions));
		redirectUriOptions.push({ value: '__custom__', text: '自定义回调地址', fieldValues: {} });
		const tableColumns = columns.map((column) => column.dataIndex === 'redirect_uri_source' ? { ...column, options: redirectUriOptions } : column);
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { toolbar: [{ key: 'create', label: '新增客户端' }], row: [{ key: 'edit', label: '编辑' }, { key: 'reset-secret', label: '重置密钥', confirm: '重置后旧密钥立即失效，确定继续吗？' }, { key: 'delete', label: '删除' }] } }, columns: tableColumns, dataSource, totalRecords: rows.length } });
	}
	if (params.id && c.req.method === 'GET') {
		const row = await oidcClient(database, params.id);
		if (!row) return apiMessage(c, 404, 'OIDC 客户端不存在');
		return apiResponse(c, 200, clientFormRow(row, await loadRedirectUriOptions(c)));
	}
	if (!params.id && c.req.method === 'POST') {
		const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
		let redirectUris: string[];
		try { redirectUris = parseRedirectUris(body.redirect_uris); } catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '回调地址不合法'); }
		let logoutPath: string;
		try { logoutPath = normalizeBackchannelPath(body.backchannel_logout_path); } catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '注销路径不合法'); }
		const name = String(body.name ?? '').trim(), id = `acct_${randomToken(18)}`, secret = randomToken(36), now = Date.now();
		if (!name) return apiMessage(c, 400, '请输入客户端名称');
		await runSql(database, sql(database).insert('passport_oidc_clients', { id, name, secret_hash: await sha256(secret), redirect_uris: JSON.stringify(redirectUris), backchannel_logout_uri: backchannelUri(redirectUris, logoutPath), allowed_scopes: String(body.allowed_scopes ?? 'openid profile email').trim() || 'openid', require_pkce: body.require_pkce === false ? 0 : 1, strict_redirect_uri: body.strict_redirect_uri === true ? 1 : 0, status: 'enabled', created_at: now, updated_at: now }));
		return apiMessageData(c, 201, `客户端已创建。客户端密钥仅显示一次：${secret}`, { id, client_secret: secret });
	}
	if (params.id && c.req.method === 'PUT') {
		const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
		let redirectUris: string[];
		try { redirectUris = parseRedirectUris(body.redirect_uris); } catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '回调地址不合法'); }
		let logoutPath: string;
		try { logoutPath = normalizeBackchannelPath(body.backchannel_logout_path); } catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '注销路径不合法'); }
		const updated = await runSql(database, sql(database).update('passport_oidc_clients', { name: String(body.name ?? '').trim(), redirect_uris: JSON.stringify(redirectUris), backchannel_logout_uri: backchannelUri(redirectUris, logoutPath), allowed_scopes: String(body.allowed_scopes ?? 'openid').trim(), require_pkce: body.require_pkce === false ? 0 : 1, strict_redirect_uri: body.strict_redirect_uri === true ? 1 : 0, status: body.status === 'disabled' ? 'disabled' : 'enabled', updated_at: Date.now() }, { id: params.id }));
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
