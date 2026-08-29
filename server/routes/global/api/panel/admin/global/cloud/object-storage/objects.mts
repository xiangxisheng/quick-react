import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/modules/base/api-response.mjs';
import { getCloudStorageProduct } from '@server/modules/global/cloud/catalog.mjs';
import { createCloudStorageAdapter, loadCloudStorageTarget } from '@server/modules/global/cloud/resolve.mjs';
import { allSql, sql } from '@server/database/sql.mjs';

const parseBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({}));
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const MAX_SINGLE_UPLOAD_SIZE = 5 * 1024 ** 3;
const safeRelativeKey = (value: unknown) => {
	const key = text(value).replace(/^\/+/, '');
	return key && !key.split('/').includes('..') ? key : '';
};
const safeRelativePrefix = (value: unknown) => {
	const valueText = text(value).replace(/^\/+/, '');
	return !valueText.split('/').includes('..') ? valueText : '';
};
const bindingOptions = async (database: Parameters<typeof loadCloudStorageTarget>[0]) => {
	const rows = await allSql<{ id: number; site_key: string; site_name: string; bucket: string; credential_name: string; provider: string; purpose: string }>(database, sql(database).select({ table: 'global_cloud_object_storage_bindings', alias: 'b', columns: { id: 'b.id', site_key: 'b.site_key', site_name: 's.name', bucket: 'bkt.bucket', credential_name: 'c.name', provider: 'c.provider', purpose: 'p.purpose' }, joins: [{ table: 'global_sites', alias: 's', left: 's.site_key', right: 'b.site_key' }, { table: 'global_cloud_object_storage_buckets', alias: 'bkt', left: 'bkt.id', right: 'b.bucket_id' }, { table: 'global_cloud_credentials', alias: 'c', left: 'c.id', right: 'bkt.cloud_credential_id' }, { table: 'global_cloud_object_storage_binding_purposes', alias: 'p', left: 'p.binding_id', right: 'b.id' }], where: [{ column: 'b.status', value: 'enabled' }, { column: 'bkt.status', value: 'enabled' }, { column: 'c.status', value: 'enabled' }], orderBy: [{ column: 's.site_key' }, { column: 'p.purpose' }, { column: 'b.id' }] }));
	const bindings = new Map<number, { site_key: string; site_name: string; bucket: string; credential_name: string; provider: string; purposes: string[] }>();
	for (const row of rows) {
		const binding = bindings.get(row.id) ?? { site_key: row.site_key, site_name: row.site_name, bucket: row.bucket, credential_name: row.credential_name, provider: row.provider, purposes: [] };
		binding.purposes.push(row.purpose);
		bindings.set(row.id, binding);
	}
	return [...bindings].map(([id, row]) => ({ value: String(id), text: `${row.site_name} (${row.site_key}) / ${row.purposes.join('、')} / ${row.credential_name} / ${getCloudStorageProduct(row.provider)} / ${row.bucket}` }));
};

const handler: ApiHandler = async (c, next) => {
	const database = c.get('database');
	const bindingId = Number(c.req.query('binding_id'));
	const options = await bindingOptions(database);
	const queryFields = [
		{ dataIndex: 'binding_id', label: '站点 Bucket 绑定', component: 'select' as const, options, defaultValue: options[0]?.value },
		{ dataIndex: 'prefix', label: '对象前缀', component: 'textbox' as const, placeholder: '可选' },
	];
	if (c.req.method === 'GET') {
		if (!Number.isInteger(bindingId) || bindingId <= 0) return apiResponse(c, 200, { table: { option: { rowKey: 'key', queryFields, actions: { query: [{ key: 'search', label: '查询' }] } }, columns: [], dataSource: [], totalRecords: 0 } });
		const target = await loadCloudStorageTarget(database, bindingId);
		if (!target) return apiMessage(c, 404, 'Bucket 绑定不存在或已停用');
		try {
			const limit = Math.min(100, Math.max(1, Number(c.req.query('pageSize')) || 10));
			const page = await createCloudStorageAdapter(target).list(`${target.key_prefix ?? ''}${safeRelativePrefix(c.req.query('prefix'))}`, text(c.req.query('cursor')) || undefined, limit);
			return apiResponse(c, 200, { table: { option: { rowKey: 'key', actions: { query: [{ key: 'search', label: '查询' }], toolbar: [{ key: 'upload', label: '上传' }], row: [{ key: 'download', label: '下载' }, { key: 'delete', label: '删除', confirm: '确认删除对象吗？' }] }, queryFields }, columns: [
				{ dataIndex: 'key', title: '对象 Key' },
				{ dataIndex: 'size', title: '大小', dataType: 'int' },
				{ dataIndex: 'lastModified', title: '最后修改' },
				{ dataIndex: 'etag', title: 'ETag' },
			], dataSource: page.objects, totalRecords: page.objects.length, nextCursor: page.nextToken, hasMore: page.hasMore } });
		} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : '对象列表读取失败'); }
	}
	if (!Number.isInteger(bindingId) || bindingId <= 0) return apiMessage(c, 400, '请选择站点 Bucket 绑定');
	const target = await loadCloudStorageTarget(database, bindingId);
	if (!target) return apiMessage(c, 404, 'Bucket 绑定不存在或已停用');
	const adapter = createCloudStorageAdapter(target);
	if (c.req.method === 'POST') {
		const body = await parseBody(c);
		const relativeKey = safeRelativeKey(body.key);
		const size = Number(body.size);
		const queryPrefix = safeRelativeKey(c.req.query('prefix'));
		const key = `${target.key_prefix ?? ''}${queryPrefix ? `${queryPrefix.replace(/\/+$/, '')}/` : ''}${relativeKey}`;
		if (!relativeKey) return apiMessage(c, 400, '对象 Key 不合法');
		if (Number.isFinite(size) && size > MAX_SINGLE_UPLOAD_SIZE) return apiMessage(c, 400, '当前单次直传最大支持 5GB，更大的文件需要分块上传');
		try { return apiResponse(c, 200, { uploadUrl: await adapter.createUploadUrl(key, text(body.content_type) || undefined), key }); }
		catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : '上传地址创建失败'); }
	}
	if (c.req.method === 'DELETE') {
		const body = await c.req.json<unknown>().catch(() => []);
		const keys = Array.isArray(body) ? body.map(String) : [text((body as Record<string, unknown>)?.key)];
		const allowedKeys = keys.filter((key) => key && !key.split('/').includes('..') && key.startsWith(target.key_prefix ?? ''));
		if (allowedKeys.length !== keys.filter(Boolean).length) return apiMessage(c, 400, '对象 Key 超出绑定范围');
		try { for (const key of allowedKeys) await adapter.deleteObject(key); }
		catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : '对象删除失败'); }
		return apiMessage(c, 200, '删除成功');
	}
	if (c.req.method === 'PUT') {
		const key = text(c.req.query('key'));
		if (!key || key.split('/').includes('..') || !key.startsWith(target.key_prefix ?? '')) return apiMessage(c, 400, '对象 Key 超出绑定范围');
		try { return apiMessageData(c, 200, '下载地址创建成功', { downloadUrl: await adapter.createDownloadUrl(key), key }); }
		catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : '下载地址创建失败'); }
	}
	return next();
};

export default handler;
