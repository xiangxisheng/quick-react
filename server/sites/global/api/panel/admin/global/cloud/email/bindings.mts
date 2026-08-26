import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { getCloudEmailProduct } from '@server/cloud/catalog.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';

const purposes = [{ value: 'email_verification', text: '邮箱验证码' }];
const allowedPurposes = new Set(purposes.map((item) => item.value));
const columns = [
	{ dataIndex: 'site_key', title: '站点', component: 'select', rules: [{ required: true, message: '请选择站点' }] },
	{ dataIndex: 'channel_id', title: '邮件通道', component: 'select', rules: [{ required: true, message: '请选择邮件通道' }] },
	{ dataIndex: 'template_id', title: '邮件模板', component: 'select', rules: [{ required: true, message: '请选择邮件模板' }] },
	{ dataIndex: 'purpose', title: '用途', component: 'select', options: purposes, rules: [{ required: true, message: '请选择用途' }] },
	{ dataIndex: 'is_default', title: '默认通道', component: 'switch' },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
];

const parseBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({}));
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const booleanValue = (value: unknown) => value === true || value === 1 || value === '1';
const listOptions = async (database: DatabaseAdapter) => {
	const [sites, channels, templates] = await Promise.all([
		database.prepare(`SELECT site_key, name FROM global_sites WHERE status = 'enabled' AND migration_status = 'ready' ORDER BY site_key`).all<{ site_key: string; name: string }>(),
		database.prepare(`SELECT ch.id, ch.account_name, ch.region, c.name AS credential_name, c.provider
			FROM global_cloud_email_channels ch JOIN global_cloud_credentials c ON c.id = ch.cloud_credential_id
			WHERE ch.status = 'enabled' AND c.status = 'enabled' ORDER BY c.name, ch.account_name`).all<{ id: number; account_name: string; region: string; credential_name: string; provider: string }>(),
		database.prepare(`SELECT id, template_key, name FROM global_cloud_email_templates WHERE status = 'enabled' ORDER BY template_key`).all<{ id: number; template_key: string; name: string }>(),
	]);
	return {
		sites: sites.results.map((item) => ({ value: item.site_key, text: `${item.name} (${item.site_key})` })),
		channels: channels.results.map((item) => ({ value: String(item.id), text: `${item.credential_name} / ${getCloudEmailProduct(item.provider)} / ${item.account_name} (${item.region})` })),
		templates: templates.results.map((item) => ({ value: String(item.id), text: `${item.name} (${item.template_key})` })),
	};
};
const validateTarget = async (database: DatabaseAdapter, siteKey: string, channelId: number, templateId: number, enabled: boolean) => {
	const [site, channel, template, publication] = await Promise.all([
		database.prepare(`SELECT site_key FROM global_sites WHERE site_key = ?1 AND status = 'enabled' AND migration_status = 'ready'`).bind(siteKey).first(),
		database.prepare(`SELECT ch.id FROM global_cloud_email_channels ch JOIN global_cloud_credentials c ON c.id = ch.cloud_credential_id
			WHERE ch.id = ?1 AND ch.status = 'enabled' AND c.status = 'enabled'`).bind(channelId).first(),
		database.prepare(`SELECT id FROM global_cloud_email_templates WHERE id = ?1 AND status = 'enabled'`).bind(templateId).first(),
		database.prepare(`SELECT template_id FROM global_cloud_email_template_publications WHERE template_id = ?1 AND channel_id = ?2 AND status = 'ready'`).bind(templateId, channelId).first(),
	]);
	return Boolean(site && channel && template && (!enabled || publication));
};
const clearOtherDefaults = (database: DatabaseAdapter, id: number, siteKey: string, purpose: string) => database.prepare(`UPDATE global_cloud_email_bindings
	SET is_default = 0, updated_at = ?4 WHERE site_key = ?1 AND purpose = ?2 AND id != ?3 AND is_default = 1`).bind(siteKey, purpose, id, Date.now()).run();
const deleteBinding = async (database: DatabaseAdapter, id: number) => {
	const row = await database.prepare(`SELECT id, status FROM global_cloud_email_bindings WHERE id = ?1`).bind(id).first<{ id: number; status: string }>();
	if (!row) return '邮件绑定不存在';
	if (row.status !== statusValues.disabled) return '邮件绑定必须先停用才能删除';
	await database.prepare(`DELETE FROM global_cloud_email_bindings WHERE id = ?1`).bind(id).run();
};

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	if (!params.id && c.req.method === 'GET') {
		const [rows, options] = await Promise.all([
			database.prepare(`SELECT b.id, b.site_key, s.name AS site_name, b.channel_id, ch.account_name, ch.region,
				c.name AS credential_name, c.provider, b.template_id, t.template_key, t.name AS template_name,
				b.purpose, b.is_default, b.status, b.created_at, b.updated_at
				FROM global_cloud_email_bindings b JOIN global_sites s ON s.site_key = b.site_key
				JOIN global_cloud_email_channels ch ON ch.id = b.channel_id JOIN global_cloud_credentials c ON c.id = ch.cloud_credential_id
				JOIN global_cloud_email_templates t ON t.id = b.template_id ORDER BY b.id DESC`).all<Record<string, unknown>>(),
			listOptions(database),
		]);
		const tableColumns = columns.map((column) => column.dataIndex === 'site_key' ? { ...column, options: options.sites }
			: column.dataIndex === 'channel_id' ? { ...column, options: options.channels }
				: column.dataIndex === 'template_id' ? { ...column, options: options.templates } : column);
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'create', label: '新增' }, { key: 'delete', label: '删除' }], row: [{ key: 'edit', label: '编辑' }, { key: 'delete', label: '删除' }] } }, columns: tableColumns, dataSource: rows.results, totalRecords: rows.results.length } });
	}
	if (!params.id && c.req.method === 'POST') {
		const body = await parseBody(c), siteKey = text(body.site_key), channelId = Number(body.channel_id), templateId = Number(body.template_id), purpose = text(body.purpose);
		const status = body.status === statusValues.disabled ? statusValues.disabled : statusValues.enabled;
		const isDefault = booleanValue(body.is_default) && status === statusValues.enabled ? 1 : 0;
		if (!allowedPurposes.has(purpose) || !Number.isInteger(channelId) || !Number.isInteger(templateId)
			|| !await validateTarget(database, siteKey, channelId, templateId, status === statusValues.enabled)) return apiMessage(c, 400, '站点、邮件通道、模板或云端审核状态不合法');
		try {
			const now = Date.now();
			const insert = `INSERT INTO global_cloud_email_bindings
				(site_key, channel_id, template_id, purpose, is_default, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`;
			if (isDefault && database.batch) await database.batch([
				{ query: insert, values: [siteKey, channelId, templateId, purpose, 0, status, now] },
				{ query: `UPDATE global_cloud_email_bindings SET is_default = 0, updated_at = ?3 WHERE site_key = ?1 AND purpose = ?2 AND is_default = 1`, values: [siteKey, purpose, now] },
				{ query: `UPDATE global_cloud_email_bindings SET is_default = 1, updated_at = ?5 WHERE site_key = ?1 AND channel_id = ?2 AND template_id = ?3 AND purpose = ?4`, values: [siteKey, channelId, templateId, purpose, now] },
			]);
			else await database.prepare(insert).bind(siteKey, channelId, templateId, purpose, isDefault, status, now).run();
			const created = await database.prepare(`SELECT id FROM global_cloud_email_bindings WHERE site_key = ?1 AND channel_id = ?2 AND template_id = ?3 AND purpose = ?4`)
				.bind(siteKey, channelId, templateId, purpose).first<{ id: number }>();
			if (created && isDefault && !database.batch) await clearOtherDefaults(database, created.id, siteKey, purpose);
		} catch { return apiMessage(c, 409, '相同站点、通道、模板和用途的绑定已存在，或该用途已有默认通道'); }
		return apiMessageData(c, 201, '邮件绑定创建成功', {});
	}
	if (!params.id && c.req.method === 'DELETE') {
		const ids = await c.req.json<unknown>().catch(() => []);
		for (const value of Array.isArray(ids) ? ids : []) {
			const error = await deleteBinding(database, Number(value));
			if (error) return apiMessage(c, 409, error);
		}
		return apiMessage(c, 200, '删除成功');
	}
	if (params.id && c.req.method === 'GET') {
		const row = await database.prepare(`SELECT id, site_key, channel_id, template_id, purpose, is_default, status, created_at, updated_at
			FROM global_cloud_email_bindings WHERE id = ?1`).bind(Number(params.id)).first();
		return row ? apiResponse(c, 200, row) : apiMessage(c, 404, '邮件绑定不存在');
	}
	if (params.id && c.req.method === 'PUT') {
		const current = await database.prepare(`SELECT id, site_key, channel_id, template_id, purpose, is_default, status
			FROM global_cloud_email_bindings WHERE id = ?1`).bind(Number(params.id)).first<Record<string, unknown>>();
		if (!current) return apiMessage(c, 404, '邮件绑定不存在');
		const body = await parseBody(c), changed = getChangedFields(body, ['site_key', 'channel_id', 'template_id', 'purpose', 'is_default', 'status']);
		const siteKey = changed.has('site_key') ? text(body.site_key) : String(current.site_key), channelId = changed.has('channel_id') ? Number(body.channel_id) : Number(current.channel_id);
		const templateId = changed.has('template_id') ? Number(body.template_id) : Number(current.template_id), purpose = changed.has('purpose') ? text(body.purpose) : String(current.purpose);
		const status = changed.has('status') && body.status === statusValues.disabled ? statusValues.disabled : changed.has('status') ? statusValues.enabled : String(current.status);
		const isDefault = status === statusValues.enabled && (changed.has('is_default') ? booleanValue(body.is_default) : Boolean(current.is_default)) ? 1 : 0;
		if (!allowedPurposes.has(purpose) || !Number.isInteger(channelId) || !Number.isInteger(templateId)
			|| !await validateTarget(database, siteKey, channelId, templateId, status === statusValues.enabled)) return apiMessage(c, 400, '站点、邮件通道、模板或云端审核状态不合法');
		try {
			const now = Date.now();
			const update = `UPDATE global_cloud_email_bindings SET site_key = ?2, channel_id = ?3, template_id = ?4,
				purpose = ?5, is_default = ?6, status = ?7, updated_at = ?8 WHERE id = ?1`;
			if (isDefault && database.batch) await database.batch([
				{ query: update, values: [Number(params.id), siteKey, channelId, templateId, purpose, 0, status, now] },
				{ query: `UPDATE global_cloud_email_bindings SET is_default = 0, updated_at = ?4 WHERE site_key = ?1 AND purpose = ?2 AND id != ?3 AND is_default = 1`, values: [siteKey, purpose, Number(params.id), now] },
				{ query: `UPDATE global_cloud_email_bindings SET is_default = 1, updated_at = ?2 WHERE id = ?1`, values: [Number(params.id), now] },
			]);
			else {
				if (isDefault) await clearOtherDefaults(database, Number(params.id), siteKey, purpose);
				await database.prepare(update).bind(Number(params.id), siteKey, channelId, templateId, purpose, isDefault, status, now).run();
			}
		} catch { return apiMessage(c, 409, '相同站点、通道、模板和用途的绑定已存在，或该用途已有默认通道'); }
		return apiMessage(c, 200, '保存成功');
	}
	if (params.id && c.req.method === 'DELETE') {
		const error = await deleteBinding(database, Number(params.id));
		return error ? apiMessage(c, 409, error) : apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
