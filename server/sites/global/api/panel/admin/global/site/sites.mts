import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';
import { buildDatabaseTarget, DatabaseTargetError, parseDatabaseTarget, type DatabaseTargetForm } from '@server/database/dsn.mjs';
import { portableTableGroups, transferPortableDatabase, type PortableTableGroup } from '@server/database/transfer.mjs';
import { listTables } from '@server/database/schema.mjs';

const siteKeyPattern = /^[a-z][a-z0-9_]*$/;
const bindingPattern = /^(?:[A-Z][A-Z0-9_]{0,63})?$/;
const allowedStatuses = new Set<string>(Object.values(statusValues));

const kindOptions = [
	{ value: 'default', text: '跟随默认库' },
	{ value: 'sqlite', text: 'SQLite 文件' },
	{ value: 'mysql', text: 'MySQL' },
	{ value: 'postgresql', text: 'PostgreSQL' },
	{ value: 'binding', text: 'Cloudflare D1 Binding' },
];
const serverKinds = ['mysql', 'postgresql'];

const columns = [
	{ dataIndex: 'id', title: 'ID', dataType: 'int' as const },
	{ dataIndex: 'site_key', title: '站点标识', component: 'textbox', rules: [{ required: true, message: '请输入站点标识' }], form: { edit: false } },
	{ dataIndex: 'name', title: '名称', component: 'textbox' },
	{ dataIndex: 'base_site_key', title: '父站点', component: 'select', placeholder: '搜索并选择父站点', rules: [{ required: true, message: '请选择父站点' }] },
	{ dataIndex: 'db_kind', title: '数据库类型', component: 'select', options: kindOptions, hideInTable: true, rules: [{ required: true, message: '请选择数据库类型' }] },
	{ dataIndex: 'db_file', title: 'SQLite 文件', component: 'textbox', hideInTable: true, dependsOn: 'db_kind', parentValues: ['sqlite'], placeholder: 'database/passport.sqlite', extra: '相对路径基于项目目录。' },
	{ dataIndex: 'db_host', title: '数据库主机', component: 'textbox', hideInTable: true, dependsOn: 'db_kind', parentValues: serverKinds, placeholder: '127.0.0.1' },
	{ dataIndex: 'db_port', title: '端口', component: 'textbox', hideInTable: true, dependsOn: 'db_kind', parentValues: serverKinds, placeholder: 'MySQL 默认 3306，PostgreSQL 默认 5432' },
	{ dataIndex: 'db_name', title: '数据库名', component: 'textbox', hideInTable: true, dependsOn: 'db_kind', parentValues: serverKinds },
	{ dataIndex: 'db_user', title: '数据库用户名', component: 'textbox', hideInTable: true, dependsOn: 'db_kind', parentValues: serverKinds },
	{ dataIndex: 'db_password', title: '数据库密码', component: 'textbox', inputType: 'password' as const, hideInTable: true, dependsOn: 'db_kind', parentValues: serverKinds, placeholder: '留空表示保留现有密码' },
	{ dataIndex: 'database_binding', title: 'D1 Binding', component: 'textbox', hideInTable: true, dependsOn: 'db_kind', parentValues: ['binding'], placeholder: 'PASSPORT_DB' },
	{ dataIndex: 'database_target', title: '数据库目标' },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
	{ dataIndex: 'migration_status', title: '迁移状态' },
];

/** 数据库目标的只读描述，不包含密码。 */
const describeTarget = (target: DatabaseTargetForm) => {
	if (target.db_kind === 'binding') return `D1 ${target.database_binding}`;
	if (target.db_kind === 'sqlite') return `SQLite ${target.db_file}`;
	if (target.db_kind === 'mysql' || target.db_kind === 'postgresql') {
		return `${target.db_kind === 'mysql' ? 'MySQL' : 'PostgreSQL'} ${target.db_host}:${target.db_port}/${target.db_name}`;
	}
	return '跟随默认库';
};

/** 列表和详情都不返回 DSN，避免把数据库密码暴露到前端。 */
const publicSite = (row: Record<string, unknown>) => {
	const target = parseDatabaseTarget(String(row.dsn ?? ''), String(row.database_binding ?? ''));
	const { dsn: _dsn, ...rest } = row;
	return { ...rest, ...target, database_target: describeTarget(target) };
};

/** 该站点需要迁移的数据分组：始终包含 base，再加上继承链上有独立表的站点。 */
const transferGroups = async (database: DatabaseAdapter, siteKey: string) => {
	const groups = new Set<PortableTableGroup>(['base']);
	let current: string | null = siteKey;
	for (let depth = 0; current && current !== 'base' && depth < 8; depth += 1) {
		if (current !== 'global' && current in portableTableGroups) groups.add(current as PortableTableGroup);
		const parent: { base_site_key: string | null } | null = await firstSql<{ base_site_key: string | null }>(database, sql(database).select({ table: 'global_sites', columns: { base_site_key: 'base_site_key' }, where: [{ column: 'site_key', value: current }] }));
		current = parent?.base_site_key ?? null;
	}
	return [...groups];
};

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
	return apiResponse(c, 200, { table: {
		option: {
			rowKey: 'site_key',
			actions: {
				query: [{ key: 'search', label: '搜索' }],
				toolbar: [{ key: 'create', label: '新增' }, { key: 'delete', label: '删除' }],
				row: [
					{ key: 'test', label: '测试连接' },
					{ key: 'migrate', label: '执行结构迁移', confirm: '将在站点数据库上执行结构 migration，确认执行？' },
					{ key: 'transfer', label: '迁移数据', confirm: '将默认库中该站点的数据复制到站点数据库；目标库相关表必须为空。确认执行？' },
					{ key: 'edit', label: '编辑' },
					{ key: 'delete', label: '删除' },
				],
			},
		},
		columns: tableColumns,
		dataSource: rows.map(publicSite),
		totalRecords: rows.length,
	} });
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
		let dsn: string, databaseBinding: string;
		try { ({ dsn, databaseBinding } = buildDatabaseTarget(body)); }
		catch (error) { return apiMessage(c, 400, error instanceof DatabaseTargetError ? error.message : '数据库配置不合法'); }
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
		return row ? apiResponse(c, 200, publicSite(row)) : apiMessage(c, 404, '站点不存在');
	}
	if (params.id && c.req.method === 'POST') {
		const action = c.req.query('action')?.trim() || 'migrate';
		const site = await firstSql<{ site_key: string; dsn: string; database_binding: string }>(database, sql(database).select({ table: 'global_sites', columns: { site_key: 'site_key', dsn: 'dsn', database_binding: 'database_binding' }, where: [{ column: 'site_key', value: params.id }] }));
		if (!site) return apiMessage(c, 404, '站点不存在');

		if (action === 'test') {
			if (site.database_binding) return apiMessage(c, 400, 'D1 Binding 由部署环境注入，无法在这里测试连接');
			if (!site.dsn) return apiMessage(c, 200, '该站点跟随默认库，无需测试连接');
			if (!c.env.SITE_DATABASE) return apiMessage(c, 501, '当前运行时不支持连接测试');
			try {
				const target = c.env.SITE_DATABASE(site.dsn);
				await firstSql(target, { query: 'SELECT 1', values: [] });
				const tables = await listTables(target);
				return apiMessage(c, 200, `连接成功，目标库当前有 ${tables.length} 张表${tables.length ? '' : '，请先执行结构迁移'}`);
			} catch (error) {
				return apiMessage(c, 400, `连接失败：${error instanceof Error ? error.message : '未知错误'}`);
			}
		}

		if (action === 'transfer') {
			if (site.database_binding) return apiMessage(c, 400, 'D1 Binding 的数据迁移必须由部署流程执行');
			if (!site.dsn) return apiMessage(c, 400, '该站点跟随默认库，无需迁移数据；请先配置独立数据库');
			if (!c.env.SITE_DATABASE) return apiMessage(c, 501, '当前运行时不支持在线数据迁移，请使用 npm run migrate:sqlite');
			const groups = await transferGroups(database, site.site_key);
			try {
				const target = c.env.SITE_DATABASE(site.dsn);
				const progress = await transferPortableDatabase(c.get('globalDatabase'), target, groups);
				const rows = progress.reduce((total, item) => total + item.rows, 0);
				return apiMessage(c, 200, `数据迁移完成：${progress.length} 张表、${rows} 行（分组 ${groups.join('、')}）`, { component: 'modal' });
			} catch (error) {
				return apiMessage(c, 400, `数据迁移失败：${error instanceof Error ? error.message : '未知错误'}`, { component: 'modal' });
			}
		}

		if (action !== 'migrate') return apiMessage(c, 400, '不支持的操作');
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
		const targetFields = ['db_kind', 'db_file', 'db_host', 'db_port', 'db_name', 'db_user', 'db_password', 'database_binding'];
		const changedFields = getChangedFields(body, ['name', 'base_site_key', 'status', ...targetFields]);
		const status = changedFields.has('status') && allowedStatuses.has(String(body.status)) ? String(body.status) : undefined;
		if (status === statusValues.enabled && current.migration_status !== 'ready') return apiMessage(c, 400, 'Migration 未完成，站点不可启用');
		if (current.is_system && status === statusValues.disabled) return apiMessage(c, 400, '系统站点不可禁用');
		// 数据库配置按整体处理：任一字段变更都重新拼接目标，密码留空则沿用原值。
		const targetChangedInput = targetFields.some((field) => changedFields.has(field));
		let nextDsn = current.dsn, nextBinding = current.database_binding;
		if (targetChangedInput) {
			const merged = { ...parseDatabaseTarget(current.dsn, current.database_binding), ...body };
			try { ({ dsn: nextDsn, databaseBinding: nextBinding } = buildDatabaseTarget(merged, current.dsn)); }
			catch (error) { return apiMessage(c, 400, error instanceof DatabaseTargetError ? error.message : '数据库配置不合法'); }
		}
		const dsn = nextDsn !== current.dsn ? nextDsn : undefined;
		const databaseBinding = nextBinding !== current.database_binding ? nextBinding : undefined;
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
