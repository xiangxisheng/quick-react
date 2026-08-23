import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { normalizeHostname } from '@server/site-router.mjs';

const statusOptions = [
	{ value: 'enabled', text: '启用', color: 'green' },
	{ value: 'disabled', text: '禁用', color: 'red' },
];

const columns = [
	{ dataIndex: 'id', title: 'ID' },
	{ dataIndex: 'hostname', title: '域名', component: 'textbox' },
	{ dataIndex: 'site_key', title: '站点', component: 'select', placeholder: '搜索并选择站点', rules: [{ required: true, message: '请选择站点' }] },
	{ dataIndex: 'status', title: '状态', component: 'select', options: statusOptions },
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

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	if (!params.id && c.req.method === 'GET') {
		const rows = await database.prepare('SELECT id, hostname, site_key, status, created_at FROM global_hosts ORDER BY id').all<Record<string, unknown>>();
		const sites = await database.prepare(`SELECT site_key, name FROM global_sites
			WHERE status = 'enabled' AND migration_status = 'ready' ORDER BY site_key`).all<{ site_key: string; name: string }>();
		const siteOptions = sites.results.map((site) => ({ value: site.site_key, text: `${site.name} (${site.site_key})` }));
		const tableColumns = columns.map((column) => column.dataIndex === 'site_key' ? { ...column, options: siteOptions } : column);
		return apiResponse(c, 200, { table: { option: { rowKey: 'id' }, columns: tableColumns, dataSource: rows.results, totalRecords: rows.results.length } });
	}
	if (!params.id && c.req.method === 'POST') {
		const body = await parseBody(c);
		const hostname = normalizeHostPattern(body.hostname);
		const siteKey = String(body.site_key ?? '').trim();
		if (!hostname) return apiMessage(c, 400, 'Host 不合法');
		const site = await database.prepare(`SELECT site_key FROM global_sites WHERE site_key = ?1
			AND status = 'enabled' AND migration_status = 'ready'`).bind(siteKey).first();
		if (!site) return apiMessage(c, 400, '站点不存在或尚未就绪');
		await database.prepare(`INSERT INTO global_hosts (hostname, site_key, status, created_at)
			VALUES (?1, ?2, 'enabled', ?3)`).bind(hostname, siteKey, Date.now()).run();
		await c.get('siteRouter').refresh();
		return apiMessage(c, 201, '新增成功');
	}
	if (!params.id && c.req.method === 'DELETE') {
		const ids = await c.req.json<unknown[]>().catch(() => []);
		for (const id of Array.isArray(ids) ? ids : []) {
			await database.prepare('DELETE FROM global_hosts WHERE id = ?1').bind(Number(id)).run();
		}
		await c.get('siteRouter').refresh();
		return apiMessage(c, 200, '删除成功');
	}
	if (params.id && c.req.method === 'GET') {
		const row = await database.prepare('SELECT id, hostname, site_key, status, created_at FROM global_hosts WHERE id = ?1')
			.bind(Number(params.id)).first();
		return row ? apiResponse(c, 200, row) : apiMessage(c, 404, 'Host 不存在');
	}
	if (params.id && c.req.method === 'PUT') {
		const body = await parseBody(c);
		const hostname = body.hostname === undefined ? null : normalizeHostPattern(body.hostname);
		if (body.hostname !== undefined && !hostname) return apiMessage(c, 400, 'Host 不合法');
		const status = body.status === 'disabled' ? 'disabled' : body.status === 'enabled' ? 'enabled' : null;
		await database.prepare(`UPDATE global_hosts SET hostname = COALESCE(?2, hostname),
			site_key = COALESCE(?3, site_key), status = COALESCE(?4, status) WHERE id = ?1`)
			.bind(Number(params.id), hostname, typeof body.site_key === 'string' ? body.site_key : null, status).run();
		await c.get('siteRouter').refresh();
		return apiMessage(c, 200, '保存成功');
	}
	if (params.id && c.req.method === 'DELETE') {
		await database.prepare('DELETE FROM global_hosts WHERE id = ?1').bind(Number(params.id)).run();
		await c.get('siteRouter').refresh();
		return apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
