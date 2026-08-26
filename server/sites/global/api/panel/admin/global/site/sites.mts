import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';

const siteKeyPattern = /^[a-z][a-z0-9_]*$/;
const bindingPattern = /^(?:[A-Z][A-Z0-9_]{0,63})?$/;
const allowedStatuses = new Set<string>(Object.values(statusValues));

const columns = [
	{ dataIndex: 'id', title: 'ID', dataType: 'int' as const },
	{ dataIndex: 'site_key', title: '站点标识', component: 'textbox' },
	{ dataIndex: 'name', title: '名称', component: 'textbox' },
	{ dataIndex: 'base_site_key', title: '父站点', component: 'select', placeholder: '搜索并选择父站点', rules: [{ required: true, message: '请选择父站点' }] },
	{ dataIndex: 'dsn', title: 'Node DSN', component: 'textbox' },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
	{ dataIndex: 'migration_status', title: '迁移状态' },
	{ dataIndex: 'database_binding', title: 'D1 Binding', component: 'textbox' },
];

const parseBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => {
	try { return await c.req.json<Record<string, unknown>>(); }
	catch { return {}; }
};
const booleanValue = (value: unknown) => value === true || value === 1 || value === '1';

const list = async (c: Parameters<ApiHandler>[0]) => {
	const database = c.get('database');
	const rows = await allSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_sites', orderBy: [{ column: 'id' }] }));
	const parentOptions = [
		{ value: 'base', text: '基础层 (base)' },
		...rows
			.filter((site) => site.is_system !== 1 && site.migration_status === 'ready')
			.map((site) => ({ value: String(site.site_key), text: `${String(site.name)} (${String(site.site_key)})` })),
	];
	const tableColumns = columns.map((column) => column.dataIndex === 'base_site_key' ? { ...column, options: parentOptions } : column);
	return apiResponse(c, 200, { table: { option: { rowKey: 'site_key', actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'create', label: '新增' }, { key: 'delete', label: '删除' }], row: [{ key: 'edit', label: '编辑' }, { key: 'delete', label: '删除' }] } }, columns: tableColumns, dataSource: rows, totalRecords: rows.length } });
};

const validateParent = async (database: DatabaseAdapter, siteKey: string, parentSiteKey: string) => {
	if (parentSiteKey === 'base') return true;
	const visited = new Set([siteKey]);
	let current = parentSiteKey;
	for (let depth = 0; depth < 8 && current !== 'base'; depth += 1) {
		if (visited.has(current)) return false;
		visited.add(current);
		const parent = await firstSql<{ base_site_key: string | null; is_system: number }>(database, sql(database).select({ table: 'global_sites', columns: { base_site_key: 'base_site_key', is_system: 'is_system' }, where: [{ column: 'site_key', value: current }] }));
		if (!parent || parent.is_system) return false;
		current = parent.base_site_key || 'base';
	}
	return current === 'base';
};

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	if (!params.id && c.req.method === 'GET') return list(c);
	if (!params.id && c.req.method === 'POST') {
		const body = await parseBody(c);
		const siteKey = String(body.site_key ?? '').trim();
		if (!siteKeyPattern.test(siteKey) || siteKey === 'base') return apiMessage(c, 400, '站点标识不合法');
		const baseSiteKey = String(body.base_site_key ?? 'base').trim() || 'base';
		const dsn = String(body.dsn ?? '').trim();
		const databaseBinding = String(body.database_binding ?? '').trim();
		if ((dsn && databaseBinding) || !bindingPattern.test(databaseBinding)) return apiMessage(c, 400, 'DSN 与 D1 Binding 只能配置一个，且 Binding 名称必须合法');
		if (!await validateParent(database, siteKey, baseSiteKey)) return apiMessage(c, 400, '父站点不存在、不可继承或会形成循环');
		await runSql(database, sql(database).insert('global_sites', { site_key: siteKey, name: String(body.name ?? siteKey).trim() || siteKey, base_site_key: baseSiteKey, dsn, database_binding: databaseBinding, status: 'disabled', migration_status: 'creating', is_default: 0, is_system: 0 }));
		let message = '站点已创建，请通过部署流程完成 migration';
		if (c.env.MIGRATE_SITE) {
			try {
				await c.env.MIGRATE_SITE(siteKey);
				message = '站点已创建并完成 migration，可在确认配置后启用';
			} catch (error) {
				message = `站点已创建，但 migration 失败：${error instanceof Error ? error.message : '未知错误'}`;
			}
		}
		await c.get('siteRouter').refresh();
		return apiMessageData(c, 201, message, { site_key: siteKey });
	}
	if (!params.id && c.req.method === 'DELETE') {
		const ids = await c.req.json<unknown[]>().catch(() => []);
		const siteKeys = Array.isArray(ids) ? ids.map(String) : [];
		for (const siteKey of siteKeys) {
			const current = await firstSql<{ is_system: number }>(database, sql(database).select({ table: 'global_sites', columns: { is_system: 'is_system' }, where: [{ column: 'site_key', value: siteKey }] }));
			if (!current || current.is_system) continue;
			await runSql(database, sql(database).delete('global_site_hosts', { site_key: siteKey }));
			await runSql(database, sql(database).delete('global_sites', { site_key: siteKey }));
		}
		await c.get('siteRouter').refresh();
		return apiMessage(c, 200, '删除成功');
	}
	if (params.id && c.req.method === 'GET') {
		const row = await firstSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_sites', where: [{ column: 'site_key', value: params.id }] }));
		return row ? apiResponse(c, 200, row) : apiMessage(c, 404, '站点不存在');
	}
	if (params.id && c.req.method === 'POST') {
		if (!c.env.MIGRATE_SITE) return apiMessage(c, 501, '当前运行时不支持在线 migration，请通过部署流程执行');
		try {
			await c.env.MIGRATE_SITE(params.id);
			await c.get('siteRouter').refresh();
			return apiMessage(c, 200, 'Migration 执行成功');
		} catch (error) {
			return apiMessage(c, 400, error instanceof Error ? error.message : 'Migration 执行失败');
		}
	}
	if (params.id && c.req.method === 'PUT') {
		const current = await firstSql<{ site_key: string; is_system: number; dsn: string; database_binding: string; base_site_key: string | null; migration_status: string }>(database, sql(database).select({ table: 'global_sites', columns: { site_key: 'site_key', is_system: 'is_system', dsn: 'dsn', database_binding: 'database_binding', base_site_key: 'base_site_key', migration_status: 'migration_status' }, where: [{ column: 'site_key', value: params.id }] }));
		if (!current) return apiMessage(c, 404, '站点不存在');
		const body = await parseBody(c);
		const changedFields = getChangedFields(body, ['name', 'base_site_key', 'dsn', 'database_binding', 'status']);
		const status = changedFields.has('status') && allowedStatuses.has(String(body.status)) ? String(body.status) : undefined;
		if (status === statusValues.enabled && current.migration_status !== 'ready') return apiMessage(c, 400, 'Migration 未完成，站点不可启用');
		if (current.is_system && status === statusValues.disabled) return apiMessage(c, 400, '系统站点不可禁用');
		const dsn = changedFields.has('dsn') && typeof body.dsn === 'string' ? body.dsn.trim() : undefined;
		const databaseBinding = changedFields.has('database_binding') && typeof body.database_binding === 'string' ? body.database_binding.trim() : undefined;
		const nextDsn = dsn ?? current.dsn;
		const nextBinding = databaseBinding ?? current.database_binding;
		if ((nextDsn && nextBinding) || !bindingPattern.test(nextBinding)) return apiMessage(c, 400, 'DSN 与 D1 Binding 只能配置一个，且 Binding 名称必须合法');
		const nextParent = changedFields.has('base_site_key') && typeof body.base_site_key === 'string' ? body.base_site_key.trim() : current.base_site_key || 'base';
		if (!await validateParent(database, params.id, nextParent)) return apiMessage(c, 400, '父站点不存在、不可继承或会形成循环');
		const targetChanged = (dsn !== undefined && dsn !== current.dsn)
			|| (databaseBinding !== undefined && databaseBinding !== current.database_binding);
		const inheritanceChanged = nextParent !== (current.base_site_key || 'base');
		if (current.is_system && targetChanged) return apiMessage(c, 400, '系统站点不可修改数据库目标');
		const values: Record<string, unknown> = { base_site_key: nextParent };
		if (changedFields.has('name') && typeof body.name === 'string') values.name = body.name.trim();
		if (dsn !== undefined) values.dsn = dsn;
		if (databaseBinding !== undefined) values.database_binding = databaseBinding;
		if (targetChanged || inheritanceChanged) {
			values.status = statusValues.disabled;
			values.migration_status = 'creating';
		} else if (status !== undefined) values.status = status;
		await runSql(database, sql(database).update('global_sites', values, { site_key: params.id }));
		await c.get('siteRouter').refresh();
		return apiMessage(c, 200, '保存成功');
	}
	if (params.id && c.req.method === 'DELETE') {
		const current = await firstSql<{ is_system: number }>(database, sql(database).select({ table: 'global_sites', columns: { is_system: 'is_system' }, where: [{ column: 'site_key', value: params.id }] }));
		if (!current) return apiMessage(c, 404, '站点不存在');
		if (current.is_system) return apiMessage(c, 400, '系统站点不可删除');
		await runSql(database, sql(database).delete('global_site_hosts', { site_key: params.id }));
		await runSql(database, sql(database).delete('global_sites', { site_key: params.id }));
		await c.get('siteRouter').refresh();
		return apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
