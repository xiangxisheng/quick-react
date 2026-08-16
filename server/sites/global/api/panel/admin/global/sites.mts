import type { ApiHandler } from '@server/api-router.mjs';
import { feedbackResponse } from '@server/api-response.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';

const siteKeyPattern = /^[a-z][a-z0-9_]*$/;
const bindingPattern = /^(?:[A-Z][A-Z0-9_]{0,63})?$/;
const allowedStatuses = new Set(['enabled', 'disabled']);

const columns = [
	{ dataIndex: 'site_key', title: '站点标识', component: 'textbox' },
	{ dataIndex: 'name', title: '名称', component: 'textbox' },
	{ dataIndex: 'base_site_key', title: '父站点', component: 'select', placeholder: '搜索并选择父站点', rules: [{ required: true, message: '请选择父站点' }] },
	{ dataIndex: 'dsn', title: 'Node DSN', component: 'textbox' },
	{ dataIndex: 'status', title: '状态', component: 'textbox' },
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
	return c.json({ table: { option: { rowKey: 'site_key' }, columns: tableColumns, dataSource: rows.results, totalRecords: rows.results.length } });
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
		if (!siteKeyPattern.test(siteKey) || siteKey === 'base') return c.json({ message: '站点标识不合法' }, 400);
		const baseSiteKey = String(body.base_site_key ?? 'base').trim() || 'base';
		const dsn = String(body.dsn ?? '').trim();
		const databaseBinding = String(body.database_binding ?? '').trim();
		if ((dsn && databaseBinding) || !bindingPattern.test(databaseBinding)) return c.json({ message: 'DSN 与 D1 Binding 只能配置一个，且 Binding 名称必须合法' }, 400);
		if (!await validateParent(database, siteKey, baseSiteKey)) return c.json({ message: '父站点不存在、不可继承或会形成循环' }, 400);
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
		return c.json({ ...feedbackResponse(message), site_key: siteKey }, 201);
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
		return c.json(feedbackResponse('删除成功'));
	}
	if (params.id && c.req.method === 'GET') {
		const row = await database.prepare(`SELECT id, site_key, name, base_site_key, dsn, database_binding,
			status, migration_status, is_default, is_system FROM global_sites WHERE site_key = ?1`).bind(params.id).first();
		return row ? c.json(row) : c.json({ message: '站点不存在' }, 404);
	}
	if (params.id && c.req.method === 'POST') {
		if (!c.env.MIGRATE_SITE) return c.json({ message: '当前运行时不支持在线 migration，请通过部署流程执行' }, 501);
		try {
			await c.env.MIGRATE_SITE(params.id);
			await c.get('siteRouter').refresh();
			return c.json(feedbackResponse('Migration 执行成功'));
		} catch (error) {
			return c.json({ message: error instanceof Error ? error.message : 'Migration 执行失败' }, 400);
		}
	}
	if (params.id && c.req.method === 'PUT') {
		const current = await database.prepare('SELECT site_key, is_system, dsn, database_binding, base_site_key, migration_status FROM global_sites WHERE site_key = ?1').bind(params.id)
			.first<{ site_key: string; is_system: number; dsn: string; database_binding: string; base_site_key: string | null; migration_status: string }>();
		if (!current) return c.json({ message: '站点不存在' }, 404);
		const body = await parseBody(c);
		const status = allowedStatuses.has(String(body.status)) ? String(body.status) : undefined;
		if (status === 'enabled' && current.migration_status !== 'ready') return c.json({ message: 'Migration 未完成，站点不可启用' }, 400);
		if (current.is_system && status === 'disabled') return c.json({ message: '系统站点不可禁用' }, 400);
		const dsn = typeof body.dsn === 'string' ? body.dsn.trim() : undefined;
		const databaseBinding = typeof body.database_binding === 'string' ? body.database_binding.trim() : undefined;
		const nextDsn = dsn ?? current.dsn;
		const nextBinding = databaseBinding ?? current.database_binding;
		if ((nextDsn && nextBinding) || !bindingPattern.test(nextBinding)) return c.json({ message: 'DSN 与 D1 Binding 只能配置一个，且 Binding 名称必须合法' }, 400);
		const nextParent = typeof body.base_site_key === 'string' ? body.base_site_key.trim() : current.base_site_key || 'base';
		if (!await validateParent(database, params.id, nextParent)) return c.json({ message: '父站点不存在、不可继承或会形成循环' }, 400);
		const targetChanged = (dsn !== undefined && dsn !== current.dsn)
			|| (databaseBinding !== undefined && databaseBinding !== current.database_binding);
		const inheritanceChanged = nextParent !== (current.base_site_key || 'base');
		if (current.is_system && targetChanged) return c.json({ message: '系统站点不可修改数据库目标' }, 400);
		await database.prepare(`UPDATE global_sites SET
			name = COALESCE(?2, name), base_site_key = ?3, dsn = COALESCE(?4, dsn), database_binding = COALESCE(?5, database_binding),
			status = CASE WHEN ?7 = 1 THEN 'disabled' ELSE COALESCE(?6, status) END,
			migration_status = CASE WHEN ?7 = 1 THEN 'creating' ELSE migration_status END
			WHERE site_key = ?1`).bind(params.id,
			typeof body.name === 'string' ? body.name.trim() : null,
			nextParent, dsn ?? null, databaseBinding ?? null,
			status ?? null, (targetChanged || inheritanceChanged) ? 1 : 0).run();
		await c.get('siteRouter').refresh();
		return c.json(feedbackResponse('保存成功'));
	}
	if (params.id && c.req.method === 'DELETE') {
		const current = await database.prepare('SELECT is_system FROM global_sites WHERE site_key = ?1').bind(params.id).first<{ is_system: number }>();
		if (!current) return c.json({ message: '站点不存在' }, 404);
		if (current.is_system) return c.json({ message: '系统站点不可删除' }, 400);
		await database.prepare('DELETE FROM global_hosts WHERE site_key = ?1').bind(params.id).run();
		await database.prepare('DELETE FROM global_sites WHERE site_key = ?1').bind(params.id).run();
		await c.get('siteRouter').refresh();
		return c.json(feedbackResponse('删除成功'));
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
