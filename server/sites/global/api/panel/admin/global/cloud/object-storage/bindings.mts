import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { getCloudStorageProduct } from '@server/cloud/catalog.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';

const purposes = [
	{ value: 'uploads', text: '上传文件' },
	{ value: 'avatars', text: '头像' },
	{ value: 'attachments', text: '附件' },
	{ value: 'backups', text: '备份' },
	{ value: 'exports', text: '导出文件' },
];
const allowedPurposes = new Set(purposes.map((item) => item.value));
const columns = [
	{ dataIndex: 'id', title: 'ID', dataType: 'int' as const },
	{ dataIndex: 'site_key', title: '站点', component: 'select', rules: [{ required: true, message: '请选择站点' }] },
	{ dataIndex: 'bucket_id', title: 'Bucket', component: 'select', rules: [{ required: true, message: '请选择 Bucket' }] },
	{ dataIndex: 'purposes', title: '用途', component: 'select', multiple: true, options: purposes, rules: [{ required: true, message: '请至少选择一个用途' }] },
	{ dataIndex: 'default_purposes', title: '默认用途', component: 'select', multiple: true, options: purposes, placeholder: '可选，必须包含在用途内' },
	{ dataIndex: 'key_prefix', title: '对象前缀', component: 'textbox', placeholder: '例如 site1/uploads/' },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
];

type BindingPurposeRow = { binding_id: number; purpose: string; is_default: number };
const parseBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({}));
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const prefix = (value: unknown) => {
	const raw = text(value).replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
	return raw ? `${raw}/` : '';
};
const parsePurposes = (value: unknown) => {
	const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
	return [...new Set(values.map(text).filter((item) => allowedPurposes.has(item)))];
};
const purposeState = (rows: BindingPurposeRow[]) => ({
	purposes: rows.map((item) => item.purpose),
	default_purposes: rows.filter((item) => Boolean(item.is_default)).map((item) => item.purpose),
});
const savePurposes = async (database: DatabaseAdapter, bindingId: number, siteKey: string, selected: string[], defaults: string[]) => {
	for (const purpose of selected) await runSql(database, sql(database).insert('global_cloud_object_storage_binding_purposes', { binding_id: bindingId, site_key: siteKey, purpose, is_default: 0 }));
	for (const purpose of defaults) {
		await runSql(database, sql(database).update('global_cloud_object_storage_binding_purposes', { is_default: 0 }, [{ column: 'site_key', value: siteKey }, { column: 'purpose', value: purpose }, { column: 'binding_id', operator: '!=', value: bindingId }]));
		await runSql(database, sql(database).update('global_cloud_object_storage_binding_purposes', { is_default: 1 }, { binding_id: bindingId, purpose }));
	}
};
const validateTarget = async (database: DatabaseAdapter, siteKey: string, bucketId: number) => {
	const [site, bucket] = await Promise.all([
		firstSql(database, sql(database).select({ table: 'global_sites', columns: { site_key: 'site_key' }, where: [{ column: 'site_key', value: siteKey }, { column: 'status', value: 'enabled' }, { column: 'migration_status', value: 'ready' }] })),
		firstSql(database, sql(database).select({ table: 'global_cloud_object_storage_buckets', columns: { id: 'id' }, where: [{ column: 'id', value: bucketId }, { column: 'status', value: 'enabled' }] })),
	]);
	return Boolean(site && bucket);
};

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	const listOptions = async () => {
		const [sites, buckets] = await Promise.all([
			allSql<{ site_key: string; name: string }>(database, sql(database).select({ table: 'global_sites', columns: { site_key: 'site_key', name: 'name' }, where: [{ column: 'status', value: 'enabled' }, { column: 'migration_status', value: 'ready' }], orderBy: [{ column: 'site_key' }] })),
			allSql<{ id: number; bucket: string; credential_name: string; provider: string }>(database, sql(database).select({ table: 'global_cloud_object_storage_buckets', alias: 'b', columns: { id: 'b.id', bucket: 'b.bucket', credential_name: 'c.name', provider: 'c.provider' }, joins: [{ table: 'global_cloud_credentials', alias: 'c', left: 'c.id', right: 'b.cloud_credential_id' }], where: [{ column: 'b.status', value: 'enabled' }, { column: 'c.status', value: 'enabled' }], orderBy: [{ column: 'c.name' }, { column: 'b.bucket' }] })),
		]);
		return {
			sites: sites.map((item) => ({ value: item.site_key, text: `${item.name} (${item.site_key})` })),
			buckets: buckets.map((item) => ({ value: String(item.id), text: `${item.credential_name} / ${getCloudStorageProduct(item.provider)} / ${item.bucket}` })),
		};
	};
	if (!params.id && c.req.method === 'GET') {
		const [rows, purposeRows, options] = await Promise.all([
			allSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_cloud_object_storage_bindings', alias: 'b', columns: { id: 'b.id', site_key: 'b.site_key', site_name: 's.name', bucket_id: 'b.bucket_id', bucket: 'bkt.bucket', credential_name: 'c.name', provider: 'c.provider', key_prefix: 'b.key_prefix', status: 'b.status', created_at: 'b.created_at', updated_at: 'b.updated_at' }, joins: [{ table: 'global_sites', alias: 's', left: 's.site_key', right: 'b.site_key' }, { table: 'global_cloud_object_storage_buckets', alias: 'bkt', left: 'bkt.id', right: 'b.bucket_id' }, { table: 'global_cloud_credentials', alias: 'c', left: 'c.id', right: 'bkt.cloud_credential_id' }], orderBy: [{ column: 'b.id', direction: 'DESC' }] })),
			allSql<BindingPurposeRow>(database, sql(database).select({ table: 'global_cloud_object_storage_binding_purposes', columns: { binding_id: 'binding_id', purpose: 'purpose', is_default: 'is_default' }, orderBy: [{ column: 'purpose' }] })),
			listOptions(),
		]);
		const purposeMap = new Map<number, BindingPurposeRow[]>();
		for (const row of purposeRows) purposeMap.set(row.binding_id, [...(purposeMap.get(row.binding_id) ?? []), row]);
		const dataSource = rows.map((row) => ({ ...row, product: getCloudStorageProduct(String(row.provider)), ...purposeState(purposeMap.get(Number(row.id)) ?? []) }));
		const tableColumns = columns.map((column) => column.dataIndex === 'site_key' ? { ...column, options: options.sites }
			: column.dataIndex === 'bucket_id' ? { ...column, options: options.buckets } : column);
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'create', label: '新增' }, { key: 'delete', label: '删除' }], row: [{ key: 'edit', label: '编辑' }, { key: 'delete', label: '删除' }] } }, columns: tableColumns, dataSource, totalRecords: dataSource.length } });
	}
	if (!params.id && c.req.method === 'POST') {
		const body = await parseBody(c);
		const siteKey = text(body.site_key), bucketId = Number(body.bucket_id), selected = parsePurposes(body.purposes);
		const defaults = parsePurposes(body.default_purposes);
		const keyPrefix = prefix(body.key_prefix), status = body.status === statusValues.disabled ? statusValues.disabled : statusValues.enabled;
		if (!siteKey || !Number.isInteger(bucketId) || !selected.length || !await validateTarget(database, siteKey, bucketId)) return apiMessage(c, 400, '站点、Bucket 或用途不合法');
		if (defaults.some((purpose) => !selected.includes(purpose))) return apiMessage(c, 400, '默认用途必须包含在已选用途中');
		const createdAt = Date.now();
		let createdBindingId: number | undefined;
		try {
			await runSql(database, sql(database).insert('global_cloud_object_storage_bindings', { site_key: siteKey, bucket_id: bucketId, key_prefix: keyPrefix, status, created_at: createdAt, updated_at: createdAt }));
			const binding = await firstSql<{ id: number }>(database, sql(database).select({ table: 'global_cloud_object_storage_bindings', columns: { id: 'id' }, where: [{ column: 'site_key', value: siteKey }, { column: 'bucket_id', value: bucketId }, { column: 'key_prefix', value: keyPrefix }] }));
			if (!binding) throw new Error('绑定创建后无法读取');
			createdBindingId = binding.id;
			await savePurposes(database, binding.id, siteKey, selected, status === statusValues.enabled ? defaults : []);
		} catch (error) {
			if (createdBindingId) await runSql(database, sql(database).delete('global_cloud_object_storage_bindings', { id: createdBindingId })).catch(() => undefined);
			return apiMessage(c, 400, error instanceof Error ? error.message : '创建绑定失败');
		}
		return apiMessageData(c, 201, 'Bucket 绑定创建成功', {});
	}
	if (!params.id && c.req.method === 'DELETE') {
		const ids = await c.req.json<unknown>().catch(() => []);
		for (const id of Array.isArray(ids) ? ids : []) await runSql(database, sql(database).delete('global_cloud_object_storage_bindings', { id: Number(id) }));
		return apiMessage(c, 200, '删除成功');
	}
	if (params.id && c.req.method === 'GET') {
		const [row, purposeRows] = await Promise.all([
			firstSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_cloud_object_storage_bindings', where: [{ column: 'id', value: Number(params.id) }] })),
			allSql<BindingPurposeRow>(database, sql(database).select({ table: 'global_cloud_object_storage_binding_purposes', columns: { binding_id: 'binding_id', purpose: 'purpose', is_default: 'is_default' }, where: [{ column: 'binding_id', value: Number(params.id) }], orderBy: [{ column: 'purpose' }] })),
		]);
		return row ? apiResponse(c, 200, { ...row, ...purposeState(purposeRows) }) : apiMessage(c, 404, 'Bucket 绑定不存在');
	}
	if (params.id && c.req.method === 'PUT') {
		const current = await firstSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_cloud_object_storage_bindings', where: [{ column: 'id', value: Number(params.id) }] }));
		if (!current) return apiMessage(c, 404, 'Bucket 绑定不存在');
		const currentPurposes = await allSql<BindingPurposeRow>(database, sql(database).select({ table: 'global_cloud_object_storage_binding_purposes', columns: { binding_id: 'binding_id', purpose: 'purpose', is_default: 'is_default' }, where: [{ column: 'binding_id', value: Number(params.id) }] }));
		const body = await parseBody(c);
		const changed = getChangedFields(body, ['site_key', 'bucket_id', 'purposes', 'default_purposes', 'key_prefix', 'status']);
		const siteKey = changed.has('site_key') ? text(body.site_key) : String(current.site_key);
		const bucketId = changed.has('bucket_id') ? Number(body.bucket_id) : Number(current.bucket_id);
		const selected = changed.has('purposes') ? parsePurposes(body.purposes) : currentPurposes.map((item) => item.purpose);
		const previousDefaults = currentPurposes.filter((item) => Boolean(item.is_default)).map((item) => item.purpose);
		const defaults = changed.has('default_purposes') ? parsePurposes(body.default_purposes) : previousDefaults.filter((purpose) => selected.includes(purpose));
		const keyPrefix = changed.has('key_prefix') ? prefix(body.key_prefix) : String(current.key_prefix);
		const status = changed.has('status') && body.status === statusValues.disabled ? statusValues.disabled : changed.has('status') ? statusValues.enabled : String(current.status);
		if (!siteKey || !Number.isInteger(bucketId) || !selected.length || !await validateTarget(database, siteKey, bucketId)) return apiMessage(c, 400, '站点、Bucket 或用途不合法');
		if (defaults.some((purpose) => !selected.includes(purpose))) return apiMessage(c, 400, '默认用途必须包含在已选用途中');
		const duplicate = await firstSql(database, sql(database).select({ table: 'global_cloud_object_storage_bindings', columns: { id: 'id' }, where: [{ column: 'site_key', value: siteKey }, { column: 'bucket_id', value: bucketId }, { column: 'key_prefix', value: keyPrefix }, { column: 'id', operator: '!=', value: Number(params.id) }] }));
		if (duplicate) return apiMessage(c, 409, '相同站点、Bucket 和对象前缀的绑定已存在');
		try {
			await runSql(database, sql(database).delete('global_cloud_object_storage_binding_purposes', { binding_id: Number(params.id) }));
			await runSql(database, sql(database).update('global_cloud_object_storage_bindings', { site_key: siteKey, bucket_id: bucketId, key_prefix: keyPrefix, status, updated_at: Date.now() }, { id: Number(params.id) }));
			await savePurposes(database, Number(params.id), siteKey, selected, status === statusValues.enabled ? defaults : []);
		} catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '保存绑定失败'); }
		return apiMessage(c, 200, '保存成功');
	}
	if (params.id && c.req.method === 'DELETE') {
		await runSql(database, sql(database).delete('global_cloud_object_storage_bindings', { id: Number(params.id) }));
		return apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
