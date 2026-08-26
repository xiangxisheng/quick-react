import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { getCloudStorageProduct } from '@server/cloud/catalog.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';

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
	for (const purpose of selected) await database.prepare(`INSERT INTO global_cloud_object_storage_binding_purposes
		(binding_id, site_key, purpose, is_default) VALUES (?1, ?2, ?3, 0)`).bind(bindingId, siteKey, purpose).run();
	for (const purpose of defaults) {
		await database.prepare(`UPDATE global_cloud_object_storage_binding_purposes SET is_default = 0
			WHERE site_key = ?1 AND purpose = ?2 AND binding_id != ?3`).bind(siteKey, purpose, bindingId).run();
		await database.prepare(`UPDATE global_cloud_object_storage_binding_purposes SET is_default = 1
			WHERE binding_id = ?1 AND purpose = ?2`).bind(bindingId, purpose).run();
	}
};
const validateTarget = async (database: DatabaseAdapter, siteKey: string, bucketId: number) => {
	const [site, bucket] = await Promise.all([
		database.prepare(`SELECT site_key FROM global_sites WHERE site_key = ?1 AND status = 'enabled' AND migration_status = 'ready'`).bind(siteKey).first(),
		database.prepare(`SELECT id FROM global_cloud_object_storage_buckets WHERE id = ?1 AND status = 'enabled'`).bind(bucketId).first(),
	]);
	return Boolean(site && bucket);
};

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	const listOptions = async () => {
		const [sites, buckets] = await Promise.all([
			database.prepare(`SELECT site_key, name FROM global_sites WHERE status = 'enabled' AND migration_status = 'ready' ORDER BY site_key`).all<{ site_key: string; name: string }>(),
			database.prepare(`SELECT b.id, b.bucket, c.name AS credential_name, c.provider
				FROM global_cloud_object_storage_buckets b JOIN global_cloud_credentials c ON c.id = b.cloud_credential_id
				WHERE b.status = 'enabled' AND c.status = 'enabled' ORDER BY c.name, b.bucket`).all<{ id: number; bucket: string; credential_name: string; provider: string }>(),
		]);
		return {
			sites: sites.results.map((item) => ({ value: item.site_key, text: `${item.name} (${item.site_key})` })),
			buckets: buckets.results.map((item) => ({ value: String(item.id), text: `${item.credential_name} / ${getCloudStorageProduct(item.provider)} / ${item.bucket}` })),
		};
	};
	if (!params.id && c.req.method === 'GET') {
		const [rows, purposeRows, options] = await Promise.all([
			database.prepare(`SELECT b.id, b.site_key, s.name AS site_name, b.bucket_id, bkt.bucket,
				c.name AS credential_name, c.provider, b.key_prefix, b.status, b.created_at, b.updated_at
				FROM global_cloud_object_storage_bindings b JOIN global_sites s ON s.site_key = b.site_key
				JOIN global_cloud_object_storage_buckets bkt ON bkt.id = b.bucket_id
				JOIN global_cloud_credentials c ON c.id = bkt.cloud_credential_id ORDER BY b.id DESC`).all<Record<string, unknown>>(),
			database.prepare(`SELECT binding_id, purpose, is_default FROM global_cloud_object_storage_binding_purposes ORDER BY purpose`).all<BindingPurposeRow>(),
			listOptions(),
		]);
		const purposeMap = new Map<number, BindingPurposeRow[]>();
		for (const row of purposeRows.results) purposeMap.set(row.binding_id, [...(purposeMap.get(row.binding_id) ?? []), row]);
		const dataSource = rows.results.map((row) => ({ ...row, product: getCloudStorageProduct(String(row.provider)), ...purposeState(purposeMap.get(Number(row.id)) ?? []) }));
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
			await database.prepare(`INSERT INTO global_cloud_object_storage_bindings (site_key, bucket_id, key_prefix, status, created_at, updated_at)
				VALUES (?1, ?2, ?3, ?4, ?5, ?5)`).bind(siteKey, bucketId, keyPrefix, status, createdAt).run();
			const binding = await database.prepare(`SELECT id FROM global_cloud_object_storage_bindings WHERE site_key = ?1 AND bucket_id = ?2 AND key_prefix = ?3`).bind(siteKey, bucketId, keyPrefix).first<{ id: number }>();
			if (!binding) throw new Error('绑定创建后无法读取');
			createdBindingId = binding.id;
			await savePurposes(database, binding.id, siteKey, selected, status === statusValues.enabled ? defaults : []);
		} catch (error) {
			if (createdBindingId) await database.prepare('DELETE FROM global_cloud_object_storage_bindings WHERE id = ?1').bind(createdBindingId).run().catch(() => undefined);
			return apiMessage(c, 400, error instanceof Error ? error.message : '创建绑定失败');
		}
		return apiMessageData(c, 201, 'Bucket 绑定创建成功', {});
	}
	if (!params.id && c.req.method === 'DELETE') {
		const ids = await c.req.json<unknown>().catch(() => []);
		for (const id of Array.isArray(ids) ? ids : []) await database.prepare('DELETE FROM global_cloud_object_storage_bindings WHERE id = ?1').bind(Number(id)).run();
		return apiMessage(c, 200, '删除成功');
	}
	if (params.id && c.req.method === 'GET') {
		const [row, purposeRows] = await Promise.all([
			database.prepare(`SELECT id, site_key, bucket_id, key_prefix, status, created_at, updated_at FROM global_cloud_object_storage_bindings WHERE id = ?1`).bind(Number(params.id)).first<Record<string, unknown>>(),
			database.prepare(`SELECT binding_id, purpose, is_default FROM global_cloud_object_storage_binding_purposes WHERE binding_id = ?1 ORDER BY purpose`).bind(Number(params.id)).all<BindingPurposeRow>(),
		]);
		return row ? apiResponse(c, 200, { ...row, ...purposeState(purposeRows.results) }) : apiMessage(c, 404, 'Bucket 绑定不存在');
	}
	if (params.id && c.req.method === 'PUT') {
		const current = await database.prepare(`SELECT id, site_key, bucket_id, key_prefix, status FROM global_cloud_object_storage_bindings WHERE id = ?1`).bind(Number(params.id)).first<Record<string, unknown>>();
		if (!current) return apiMessage(c, 404, 'Bucket 绑定不存在');
		const currentPurposes = await database.prepare(`SELECT binding_id, purpose, is_default FROM global_cloud_object_storage_binding_purposes WHERE binding_id = ?1`).bind(Number(params.id)).all<BindingPurposeRow>();
		const body = await parseBody(c);
		const changed = getChangedFields(body, ['site_key', 'bucket_id', 'purposes', 'default_purposes', 'key_prefix', 'status']);
		const siteKey = changed.has('site_key') ? text(body.site_key) : String(current.site_key);
		const bucketId = changed.has('bucket_id') ? Number(body.bucket_id) : Number(current.bucket_id);
		const selected = changed.has('purposes') ? parsePurposes(body.purposes) : currentPurposes.results.map((item) => item.purpose);
		const previousDefaults = currentPurposes.results.filter((item) => Boolean(item.is_default)).map((item) => item.purpose);
		const defaults = changed.has('default_purposes') ? parsePurposes(body.default_purposes) : previousDefaults.filter((purpose) => selected.includes(purpose));
		const keyPrefix = changed.has('key_prefix') ? prefix(body.key_prefix) : String(current.key_prefix);
		const status = changed.has('status') && body.status === statusValues.disabled ? statusValues.disabled : changed.has('status') ? statusValues.enabled : String(current.status);
		if (!siteKey || !Number.isInteger(bucketId) || !selected.length || !await validateTarget(database, siteKey, bucketId)) return apiMessage(c, 400, '站点、Bucket 或用途不合法');
		if (defaults.some((purpose) => !selected.includes(purpose))) return apiMessage(c, 400, '默认用途必须包含在已选用途中');
		const duplicate = await database.prepare(`SELECT id FROM global_cloud_object_storage_bindings WHERE site_key = ?1 AND bucket_id = ?2 AND key_prefix = ?3 AND id != ?4`).bind(siteKey, bucketId, keyPrefix, Number(params.id)).first();
		if (duplicate) return apiMessage(c, 409, '相同站点、Bucket 和对象前缀的绑定已存在');
		try {
			await database.prepare('DELETE FROM global_cloud_object_storage_binding_purposes WHERE binding_id = ?1').bind(Number(params.id)).run();
			await database.prepare(`UPDATE global_cloud_object_storage_bindings SET site_key = ?2, bucket_id = ?3, key_prefix = ?4, status = ?5, updated_at = ?6 WHERE id = ?1`).bind(Number(params.id), siteKey, bucketId, keyPrefix, status, Date.now()).run();
			await savePurposes(database, Number(params.id), siteKey, selected, status === statusValues.enabled ? defaults : []);
		} catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '保存绑定失败'); }
		return apiMessage(c, 200, '保存成功');
	}
	if (params.id && c.req.method === 'DELETE') {
		await database.prepare('DELETE FROM global_cloud_object_storage_bindings WHERE id = ?1').bind(Number(params.id)).run();
		return apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
