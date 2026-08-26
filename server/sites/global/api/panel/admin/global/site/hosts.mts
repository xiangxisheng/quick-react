import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { normalizeHostname } from '@server/site-router.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';

const columns = [
	{ dataIndex: 'id', title: 'ID' },
	{ dataIndex: 'hostname', title: '域名', component: 'textbox' },
	{ dataIndex: 'site_key', title: '站点', component: 'select', placeholder: '搜索并选择站点', rules: [{ required: true, message: '请选择站点' }] },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
];

const normalizeHostPattern = (value: unknown) => {
	const raw = String(value ?? '').trim();
	if (raw.startsWith('*.')) {
		const suffix = normalizeHostname(raw.slice(2));
		return suffix && !suffix.includes(':') ? `*.${suffix}` : '';
	}
	return normalizeHostname(raw);
};

const parseBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => {
	try { return await c.req.json<Record<string, unknown>>(); }
	catch { return {}; }
};

const removeHost = async (c: Parameters<ApiHandler>[0], id: number) => {
	const database = c.get('database');
	const host = await firstSql<{ hostname: string; status: string }>(database, sql(database).select({ table: 'global_site_hosts', columns: { hostname: 'hostname', status: 'status' }, where: [{ column: 'id', value: id }] }));
	if (!host) return undefined;
	if (host.status !== statusValues.disabled) return apiMessage(c, 409, '域名必须先停用才能删除');
	const bot = await firstSql(database, sql(database).select({ table: 'global_telegram_bots', columns: { id: 'id' }, where: [{ column: 'webhook_hostname', value: host.hostname }], limit: 1 }));
	if (bot) return apiMessage(c, 409, '域名正在被 Telegram 机器人使用，不能删除');
	await runSql(database, sql(database).delete('global_site_hosts', { id }));
	return undefined;
};

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	if (!params.id && c.req.method === 'GET') {
		const rows = await allSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_site_hosts', columns: { id: 'id', hostname: 'hostname', site_key: 'site_key', status: 'status', created_at: 'created_at' }, orderBy: [{ column: 'id' }] }));
		const sites = await allSql<{ site_key: string; name: string }>(database, sql(database).select({ table: 'global_sites', columns: { site_key: 'site_key', name: 'name' }, where: [{ column: 'status', value: 'enabled' }, { column: 'migration_status', value: 'ready' }], orderBy: [{ column: 'site_key' }] }));
		const siteOptions = sites.map((site) => ({ value: site.site_key, text: `${site.name} (${site.site_key})` }));
		const tableColumns = columns.map((column) => column.dataIndex === 'site_key' ? { ...column, options: siteOptions } : column);
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'create', label: '新增' }, { key: 'delete', label: '删除' }], row: [{ key: 'edit', label: '编辑' }, { key: 'delete', label: '删除' }] } }, columns: tableColumns, dataSource: rows, totalRecords: rows.length } });
	}
	if (!params.id && c.req.method === 'POST') {
		const body = await parseBody(c);
		const hostname = normalizeHostPattern(body.hostname);
		const siteKey = String(body.site_key ?? '').trim();
		if (!hostname) return apiMessage(c, 400, 'Host 不合法');
		const site = await firstSql(database, sql(database).select({ table: 'global_sites', columns: { site_key: 'site_key' }, where: [{ column: 'site_key', value: siteKey }, { column: 'status', value: 'enabled' }, { column: 'migration_status', value: 'ready' }] }));
		if (!site) return apiMessage(c, 400, '站点不存在或尚未就绪');
		await runSql(database, sql(database).insert('global_site_hosts', { hostname, site_key: siteKey, status: 'enabled', created_at: Date.now() }));
		await c.get('siteRouter').refresh();
		return apiMessage(c, 201, '新增成功');
	}
	if (!params.id && c.req.method === 'DELETE') {
		const ids = await c.req.json<unknown[]>().catch(() => []);
		for (const id of Array.isArray(ids) ? ids : []) {
			const response = await removeHost(c, Number(id));
			if (response) return response;
		}
		await c.get('siteRouter').refresh();
		return apiMessage(c, 200, '删除成功');
	}
	if (params.id && c.req.method === 'GET') {
		const row = await firstSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_site_hosts', columns: { id: 'id', hostname: 'hostname', site_key: 'site_key', status: 'status', created_at: 'created_at' }, where: [{ column: 'id', value: Number(params.id) }] }));
		return row ? apiResponse(c, 200, row) : apiMessage(c, 404, 'Host 不存在');
	}
	if (params.id && c.req.method === 'PUT') {
		const current = await firstSql<{ hostname: string; site_key: string; status: string }>(database, sql(database).select({ table: 'global_site_hosts', columns: { hostname: 'hostname', site_key: 'site_key', status: 'status' }, where: [{ column: 'id', value: Number(params.id) }] }));
		if (!current) return apiMessage(c, 404, 'Host 不存在');
		const body = await parseBody(c);
		const changedFields = getChangedFields(body, ['hostname', 'site_key', 'status']);
		const hostname = changedFields.has('hostname') ? normalizeHostPattern(body.hostname) : null;
		if (changedFields.has('hostname') && !hostname) return apiMessage(c, 400, 'Host 不合法');
		const status = !changedFields.has('status') ? null : body.status === statusValues.disabled ? statusValues.disabled : body.status === statusValues.enabled ? statusValues.enabled : null;
		const nextSiteKey = changedFields.has('site_key') && typeof body.site_key === 'string' ? body.site_key.trim() : current.site_key;
		const site = await firstSql(database, sql(database).select({ table: 'global_sites', columns: { site_key: 'site_key' }, where: [{ column: 'site_key', value: nextSiteKey }, { column: 'status', value: 'enabled' }, { column: 'migration_status', value: 'ready' }] }));
		if (!site) return apiMessage(c, 400, '站点不存在或尚未就绪');
		const bot = await firstSql(database, sql(database).select({ table: 'global_telegram_bots', columns: { id: 'id' }, where: [{ column: 'webhook_hostname', value: current.hostname }], limit: 1 }));
		if (bot && ((hostname && hostname !== current.hostname) || nextSiteKey !== 'passport' || status === statusValues.disabled)) {
			return apiMessage(c, 409, '域名正在被 Telegram 机器人使用，请先切换或停用相关机器人');
		}
		const values: Record<string, unknown> = {};
		if (hostname) values.hostname = hostname;
		if (changedFields.has('site_key')) values.site_key = nextSiteKey;
		if (status) values.status = status;
		if (Object.keys(values).length) await runSql(database, sql(database).update('global_site_hosts', values, { id: Number(params.id) }));
		await c.get('siteRouter').refresh();
		return apiMessage(c, 200, '保存成功');
	}
	if (params.id && c.req.method === 'DELETE') {
		const response = await removeHost(c, Number(params.id));
		if (response) return response;
		await c.get('siteRouter').refresh();
		return apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
