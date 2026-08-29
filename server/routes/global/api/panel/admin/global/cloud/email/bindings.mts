import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/modules/base/api-response.mjs';
import { getCloudEmailProduct, getCloudEmailRegionLabel } from '@server/modules/global/cloud/catalog.mjs';
import { cloudEmailPurposeOptions } from '@server/modules/global/cloud/email-purposes.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { getChangedFields } from '@server/modules/base/changed-fields.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';

const columns = [
	{ dataIndex: 'id', title: 'ID', dataType: 'int' as const },
	{ dataIndex: 'site_key', title: '站点', component: 'select', rules: [{ required: true, message: '请选择站点' }] },
	{ dataIndex: 'channel_id', title: '邮件通道', component: 'select', tableDisplay: 'reference', tableDisplayTextField: 'account_name', rules: [{ required: true, message: '请选择邮件通道' }] },
	{ dataIndex: 'template_id', title: '邮件模板', component: 'select', tableDisplay: 'reference', tableDisplayTextField: 'template_name', rules: [{ required: true, message: '请选择邮件模板' }] },
	{ dataIndex: 'purpose', title: '类型', options: cloudEmailPurposeOptions },
	{ dataIndex: 'is_default', title: '默认通道', component: 'switch' },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
];

const parseBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({}));
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const booleanValue = (value: unknown) => value === true || value === 1 || value === '1';
const listOptions = async (database: DatabaseAdapter) => {
	const [sites, channels, templates] = await Promise.all([
		allSql<{ site_key: string; name: string }>(database, sql(database).select({ table: 'global_sites', columns: { site_key: 'site_key', name: 'name' }, where: [{ column: 'status', value: 'enabled' }, { column: 'migration_status', value: 'ready' }], orderBy: [{ column: 'site_key' }] })),
		allSql<{ id: number; account_name: string; region: string; credential_name: string; provider: string }>(database, sql(database).select({ table: 'global_cloud_email_channels', alias: 'ch', columns: { id: 'ch.id', account_name: 'ch.account_name', region: 'ch.region', credential_name: 'c.name', provider: 'c.provider' }, joins: [{ table: 'global_cloud_credentials', alias: 'c', left: 'c.id', right: 'ch.cloud_credential_id' }], where: [{ column: 'ch.status', value: 'enabled' }, { column: 'c.status', value: 'enabled' }], orderBy: [{ column: 'c.name' }, { column: 'ch.account_name' }] })),
		allSql<{ id: number; template_key: string; template_type: string; name: string }>(database, sql(database).select({ table: 'global_cloud_email_templates', columns: { id: 'id', template_key: 'template_key', template_type: 'template_type', name: 'name' }, where: [{ column: 'status', value: 'enabled' }], orderBy: [{ column: 'template_type' }, { column: 'template_key' }] })),
	]);
	return {
		sites: sites.map((item) => ({ value: item.site_key, text: `${item.name} (${item.site_key})` })),
		channels: channels.map((item) => ({ value: String(item.id), text: `${item.credential_name} / ${getCloudEmailProduct(item.provider)} / ${item.account_name} / ${getCloudEmailRegionLabel(item.provider, item.region)}（${item.region}）` })),
		templates: templates.map((item) => ({ value: String(item.id), text: `${cloudEmailPurposeOptions.find((purpose) => purpose.value === item.template_type)?.text ?? item.template_type} / ${item.name} (${item.template_key})` })),
	};
};
type TargetValidation = { purpose: string } | { error: string };

const validateTarget = async (database: DatabaseAdapter, siteKey: string, channelId: number, templateId: number, enabled: boolean): Promise<TargetValidation> => {
	if (!siteKey) return { error: '请选择站点' };
	const [site, channel, template] = await Promise.all([
		firstSql(database, sql(database).select({ table: 'global_sites', columns: { site_key: 'site_key' }, where: [{ column: 'site_key', value: siteKey }, { column: 'status', value: 'enabled' }, { column: 'migration_status', value: 'ready' }] })),
		firstSql<{ id: number; cloud_credential_id: number; region: string }>(database, sql(database).select({ table: 'global_cloud_email_channels', alias: 'ch', columns: { id: 'ch.id', cloud_credential_id: 'ch.cloud_credential_id', region: 'ch.region' }, joins: [{ table: 'global_cloud_credentials', alias: 'c', left: 'c.id', right: 'ch.cloud_credential_id' }], where: [{ column: 'ch.id', value: channelId }, { column: 'ch.status', value: 'enabled' }, { column: 'c.status', value: 'enabled' }] })),
		firstSql<{ id: number; template_type: string }>(database, sql(database).select({ table: 'global_cloud_email_templates', columns: { id: 'id', template_type: 'template_type' }, where: [{ column: 'id', value: templateId }, { column: 'status', value: 'enabled' }] })),
	]);
	if (!site) return { error: '所选站点不可用：站点必须已启用且迁移完成' };
	if (!channel) return { error: '所选邮件通道不可用：通道及其云凭据必须均已启用' };
	if (!template) return { error: '所选邮件模板不可用：模板必须已启用' };
	if (!enabled) return { purpose: template.template_type };
	const publication = await firstSql<{ status: string }>(database, sql(database).select({ table: 'global_cloud_email_template_publications', columns: { status: 'status' }, where: [{ column: 'template_id', value: templateId }, { column: 'cloud_credential_id', value: channel.cloud_credential_id }, { column: 'region', value: channel.region }] }));
	if (!publication) return { error: '所选模板尚未发布到该邮件通道使用的云凭据和 Region，请先在模板管理中发布/更新' };
	if (publication.status !== 'ready') {
		const statusText = publication.status === 'reviewing' ? '审核中' : publication.status === 'failed' ? '审核未通过' : `状态为 ${publication.status}`;
		return { error: `所选模板在该邮件通道使用的云凭据和 Region ${statusText}，审核通过后才能启用绑定` };
	}
	return { purpose: template.template_type };
};
const clearOtherDefaults = (database: DatabaseAdapter, id: number, siteKey: string, purpose: string) => runSql(database, sql(database).update('global_cloud_email_bindings', { is_default: 0, updated_at: Date.now() }, [{ column: 'site_key', value: siteKey }, { column: 'purpose', value: purpose }, { column: 'id', operator: '!=', value: id }, { column: 'is_default', value: 1 }]));
const deleteBinding = async (database: DatabaseAdapter, id: number) => {
	const row = await firstSql<{ id: number; status: string }>(database, sql(database).select({ table: 'global_cloud_email_bindings', columns: { id: 'id', status: 'status' }, where: [{ column: 'id', value: id }] }));
	if (!row) return '邮件绑定不存在';
	if (row.status !== statusValues.disabled) return '邮件绑定必须先停用才能删除';
	await runSql(database, sql(database).delete('global_cloud_email_bindings', { id }));
};

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	if (!params.id && c.req.method === 'GET') {
		const [rows, options] = await Promise.all([
			allSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_cloud_email_bindings', alias: 'b', columns: { id: 'b.id', site_key: 'b.site_key', site_name: 's.name', channel_id: 'b.channel_id', account_name: 'ch.account_name', region: 'ch.region', credential_name: 'c.name', provider: 'c.provider', template_id: 'b.template_id', template_key: 't.template_key', template_name: 't.name', purpose: 'b.purpose', is_default: 'b.is_default', status: 'b.status', created_at: 'b.created_at', updated_at: 'b.updated_at' }, joins: [{ table: 'global_sites', alias: 's', left: 's.site_key', right: 'b.site_key' }, { table: 'global_cloud_email_channels', alias: 'ch', left: 'ch.id', right: 'b.channel_id' }, { table: 'global_cloud_credentials', alias: 'c', left: 'c.id', right: 'ch.cloud_credential_id' }, { table: 'global_cloud_email_templates', alias: 't', left: 't.id', right: 'b.template_id' }], orderBy: [{ column: 'b.id', direction: 'DESC' }] })),
			listOptions(database),
		]);
		const tableColumns = columns.map((column) => column.dataIndex === 'site_key' ? { ...column, options: options.sites }
			: column.dataIndex === 'channel_id' ? { ...column, options: options.channels }
				: column.dataIndex === 'template_id' ? { ...column, options: options.templates } : column);
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'create', label: '新增' }, { key: 'delete', label: '删除' }], row: [{ key: 'edit', label: '编辑' }, { key: 'delete', label: '删除' }] } }, columns: tableColumns, dataSource: rows, totalRecords: rows.length } });
	}
	if (!params.id && c.req.method === 'POST') {
		const body = await parseBody(c), siteKey = text(body.site_key), channelId = Number(body.channel_id), templateId = Number(body.template_id);
		const status = body.status === statusValues.disabled ? statusValues.disabled : statusValues.enabled;
		const isDefault = booleanValue(body.is_default) && status === statusValues.enabled ? 1 : 0;
		if (!Number.isInteger(channelId) || channelId <= 0) return apiMessage(c, 400, '请选择有效的邮件通道');
		if (!Number.isInteger(templateId) || templateId <= 0) return apiMessage(c, 400, '请选择有效的邮件模板');
		const target = await validateTarget(database, siteKey, channelId, templateId, status === statusValues.enabled);
		if ('error' in target) return apiMessage(c, 400, target.error);
		const { purpose } = target;
		try {
			const now = Date.now();
			const builder = sql(database);
			const insert = builder.insert('global_cloud_email_bindings', { site_key: siteKey, channel_id: channelId, template_id: templateId, purpose, is_default: isDefault && !database.batch ? isDefault : 0, status, created_at: now, updated_at: now });
			if (isDefault && database.batch) await database.batch([
				insert,
				builder.update('global_cloud_email_bindings', { is_default: 0, updated_at: now }, { site_key: siteKey, purpose, is_default: 1 }),
				builder.update('global_cloud_email_bindings', { is_default: 1, updated_at: now }, { site_key: siteKey, channel_id: channelId, template_id: templateId, purpose }),
			]);
			else await runSql(database, insert);
			const created = await firstSql<{ id: number }>(database, builder.select({ table: 'global_cloud_email_bindings', columns: { id: 'id' }, where: [{ column: 'site_key', value: siteKey }, { column: 'channel_id', value: channelId }, { column: 'template_id', value: templateId }, { column: 'purpose', value: purpose }] }));
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
		const row = await firstSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_cloud_email_bindings', where: [{ column: 'id', value: Number(params.id) }] }));
		return row ? apiResponse(c, 200, row) : apiMessage(c, 404, '邮件绑定不存在');
	}
	if (params.id && c.req.method === 'PUT') {
		const current = await firstSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_cloud_email_bindings', where: [{ column: 'id', value: Number(params.id) }] }));
		if (!current) return apiMessage(c, 404, '邮件绑定不存在');
		const body = await parseBody(c), changed = getChangedFields(body, ['site_key', 'channel_id', 'template_id', 'is_default', 'status']);
		const siteKey = changed.has('site_key') ? text(body.site_key) : String(current.site_key), channelId = changed.has('channel_id') ? Number(body.channel_id) : Number(current.channel_id);
		const templateId = changed.has('template_id') ? Number(body.template_id) : Number(current.template_id);
		const status = changed.has('status') && body.status === statusValues.disabled ? statusValues.disabled : changed.has('status') ? statusValues.enabled : String(current.status);
		const isDefault = status === statusValues.enabled && (changed.has('is_default') ? booleanValue(body.is_default) : Boolean(current.is_default)) ? 1 : 0;
		if (!Number.isInteger(channelId) || channelId <= 0) return apiMessage(c, 400, '请选择有效的邮件通道');
		if (!Number.isInteger(templateId) || templateId <= 0) return apiMessage(c, 400, '请选择有效的邮件模板');
		const target = await validateTarget(database, siteKey, channelId, templateId, status === statusValues.enabled);
		if ('error' in target) return apiMessage(c, 400, target.error);
		const { purpose } = target;
		try {
			const now = Date.now();
			const builder = sql(database);
			const update = builder.update('global_cloud_email_bindings', { site_key: siteKey, channel_id: channelId, template_id: templateId, purpose, is_default: isDefault && !database.batch ? isDefault : 0, status, updated_at: now }, { id: Number(params.id) });
			if (isDefault && database.batch) await database.batch([
				update,
				builder.update('global_cloud_email_bindings', { is_default: 0, updated_at: now }, [{ column: 'site_key', value: siteKey }, { column: 'purpose', value: purpose }, { column: 'id', operator: '!=', value: Number(params.id) }, { column: 'is_default', value: 1 }]),
				builder.update('global_cloud_email_bindings', { is_default: 1, updated_at: now }, { id: Number(params.id) }),
			]);
			else {
				if (isDefault) await clearOtherDefaults(database, Number(params.id), siteKey, purpose);
				await runSql(database, update);
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
