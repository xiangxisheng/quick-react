import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';

const siteKeyPattern = /^[a-z][a-z0-9_]*$/;
const bindingPattern = /^(?:[A-Z][A-Z0-9_]{0,63})?$/;
const allowedStatuses = new Set<string>(Object.values(statusValues));

const columns = [
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

const list = async (c: Parameters<ApiHandler>[0]) => {
	const database = c.get('database');
	const rows = await database.prepare(`SELECT id, site_key, name, base_site_key, dsn,
		database_binding, status, migration_status, is_default, is_system
		FROM global_sites ORDER BY id`).all<Record<string, unknown>>();
	const parentOptions = [
		{ value: 'base', text: '基础层 (base)' },
		...rows.results
			.filter((site) => site.is_system !== 1 && site.migration_status === 'ready')
			.map((site) => ({ value: String(site.site_key), text: `${String(site.name)} (${String(site.site_key)})` })),
	];
	const tableColumns = columns.map((column) => column.dataIndex === 'base_site_key' ? { ...column, options: parentOptions } : column);
	return apiResponse(c, 200, { table: { option: { rowKey: 'site_key', actions: { query: [{ key: 'search', label: '搜索', action: 'search' }], toolbar: [{ key: 'create', label: '新增', action: 'create' }, { key: 'delete', label: '删除', action: 'delete' }], row: [{ key: 'edit', label: '编辑', action: 'edit' }, { key: 'delete', label: '删除', action: 'delete' }] } }, columns: tableColumns, dataSource: rows.results, totalRecords: rows.results.length } });
};

const validateParent = async (database: DatabaseAdapter, siteKey: string, parentSiteKey: string) => {
	if (parentSiteKey === 'base') return true;
	const visited = new Set([siteKey]);
	let current = parentSiteKey;
	for (let depth = 0; depth < 8 && current !== 'base'; depth += 1) {
		if (visited.has(current)) return false;
		visited.add(current);
		const parent = await database.prepare('SELECT base_site_key, is_system FROM global_sites WHERE site_key = ?1').bind(current)
			.first<{ base_site_key: string | null; is_system: number }>();
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
		await database.prepare(`INSERT INTO global_sites
			(site_key, name, base_site_key, dsn, database_binding, status, migration_status, is_default, is_system)
			VALUES (?1, ?2, ?3, ?4, ?5, 'disabled', 'creating', 0, 0)`)
			.bind(siteKey, String(body.name ?? siteKey).trim() || siteKey, baseSiteKey, dsn, databaseBinding).run();
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
			const current = await database.prepare('SELECT is_system FROM global_sites WHERE site_key = ?1').bind(siteKey).first<{ is_system: number }>();
			if (!current || current.is_system) continue;
			await database.prepare('DELETE FROM global_hosts WHERE site_key = ?1').bind(siteKey).run();
			await database.prepare('DELETE FROM global_sites WHERE site_key = ?1').bind(siteKey).run();
		}
		await c.get('siteRouter').refresh();
		return apiMessage(c, 200, '删除成功');
	}
	if (params.id && c.req.method === 'GET') {
		const row = await database.prepare(`SELECT id, site_key, name, base_site_key, dsn, database_binding,
			status, migration_status, is_default, is_system FROM global_sites WHERE site_key = ?1`).bind(params.id).first();
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
		const current = await database.prepare('SELECT site_key, is_system, dsn, database_binding, base_site_key, migration_status FROM global_sites WHERE site_key = ?1').bind(params.id)
			.first<{ site_key: string; is_system: number; dsn: string; database_binding: string; base_site_key: string | null; migration_status: string }>();
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
		await database.prepare(`UPDATE global_sites SET
			name = COALESCE(?2, name), base_site_key = ?3, dsn = COALESCE(?4, dsn), database_binding = COALESCE(?5, database_binding),
			status = CASE WHEN ?7 = 1 THEN 'disabled' ELSE COALESCE(?6, status) END,
			migration_status = CASE WHEN ?7 = 1 THEN 'creating' ELSE migration_status END
			WHERE site_key = ?1`).bind(params.id,
			changedFields.has('name') && typeof body.name === 'string' ? body.name.trim() : null,
			nextParent, dsn ?? null, databaseBinding ?? null,
			status ?? null, (targetChanged || inheritanceChanged) ? 1 : 0).run();
		await c.get('siteRouter').refresh();
		return apiMessage(c, 200, '保存成功');
	}
	if (params.id && c.req.method === 'DELETE') {
		const current = await database.prepare('SELECT is_system FROM global_sites WHERE site_key = ?1').bind(params.id).first<{ is_system: number }>();
		if (!current) return apiMessage(c, 404, '站点不存在');
		if (current.is_system) return apiMessage(c, 400, '系统站点不可删除');
		await database.prepare('DELETE FROM global_hosts WHERE site_key = ?1').bind(params.id).run();
		await database.prepare('DELETE FROM global_sites WHERE site_key = ?1').bind(params.id).run();
		await c.get('siteRouter').refresh();
		return apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
