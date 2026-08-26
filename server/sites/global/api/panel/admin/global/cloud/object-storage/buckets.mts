import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { cloudProviderOptions, getCloudBucketFieldValues, getCloudDiscoveryDefaults, getCloudStorageProduct, providerSupportsObjectStorage } from '@server/cloud/catalog.mjs';
import { createCloudStorageAdapter } from '@server/cloud/resolve.mjs';
import type { CloudCredential, CloudStorageTarget } from '@server/cloud/index.mjs';
import { listAliyunOssBuckets } from '@server/cloud/providers/aliyun-oss.mjs';
import { listTencentCosBuckets } from '@server/cloud/providers/tencent-cos.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';

const baseColumns = [
	{ dataIndex: 'id', title: 'ID', dataType: 'int' as const },
	{ dataIndex: 'cloud_credential_id', title: '凭据', component: 'select', rules: [{ required: true, message: '请选择凭据' }] },
	{ dataIndex: 'bucket', title: 'Bucket', component: 'select', allowCustomValue: true, remoteOptions: { action: 'discover', dependencies: ['cloud_credential_id'], clearFields: ['endpoint', 'region', 'path_style'] }, rules: [{ required: true, message: '请选择或输入 Bucket' }] },
	{ dataIndex: 'provider', title: 'Provider' },
	{ dataIndex: 'product', title: '产品' },
	{ dataIndex: 'endpoint', title: 'Endpoint', component: 'textbox', rules: [{ required: true, message: '请输入 Endpoint' }] },
	{ dataIndex: 'region', title: 'Region', component: 'textbox' },
	{ dataIndex: 'path_style', title: 'Path Style', component: 'switch' },
	{ dataIndex: 'public_base_url', title: '公共访问地址', component: 'textbox' },
	{ dataIndex: 'extra_config', title: '扩展配置 JSON', component: 'textarea', placeholder: '{}' },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
];

const parseBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({}));
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const booleanValue = (value: unknown) => value === true || value === 1 || value === '1';
const validEndpoint = (value: string) => {
	try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
};
const credentialOptions = async (database: DatabaseAdapter) => {
	const rows = await allSql<{ id: number; name: string; provider: string }>(database, sql(database).select({ table: 'global_cloud_credentials', columns: { id: 'id', name: 'name', provider: 'provider' }, where: [{ column: 'status', value: 'enabled' }], orderBy: [{ column: 'provider' }, { column: 'name' }] }));
	const providerNames = new Map<string, string>(cloudProviderOptions.map((item) => [item.value, item.text]));
	return rows.filter((item) => providerSupportsObjectStorage(item.provider))
		.map((item) => ({ value: String(item.id), text: `${item.name} (${providerNames.get(item.provider) ?? item.provider})` }));
};
const columnsWithCredentials = async (database: DatabaseAdapter) => {
	const options = await credentialOptions(database);
	return baseColumns.map((column) => column.dataIndex === 'cloud_credential_id' ? { ...column, options } : column);
};
const loadCredential = (database: DatabaseAdapter, credentialId: number) => firstSql<CloudCredential>(database, sql(database).select({ table: 'global_cloud_credentials', columns: { id: 'id', name: 'name', provider: 'provider', account_id: 'account_id', access_key_id: 'access_key_id', access_key_secret: 'access_key_secret', status: 'status' }, where: [{ column: 'id', value: credentialId }, { column: 'status', value: 'enabled' }] }));
const parseExtra = (value: unknown, fallback = '{}') => {
	const extra = text(value) || fallback;
	try { JSON.parse(extra); return extra; } catch { return null; }
};
const targetById = (database: DatabaseAdapter, id: number) => firstSql<CloudStorageTarget>(database, sql(database).select({ table: 'global_cloud_object_storage_buckets', alias: 'b', columns: { id: 'b.id', provider: 'c.provider', cloud_credential_id: 'b.cloud_credential_id', endpoint: 'b.endpoint', region: 'b.region', bucket: 'b.bucket', path_style: 'b.path_style', public_base_url: 'b.public_base_url', extra_config: 'b.extra_config', access_key_id: 'c.access_key_id', access_key_secret: 'c.access_key_secret' }, joins: [{ table: 'global_cloud_credentials', alias: 'c', left: 'c.id', right: 'b.cloud_credential_id' }], where: [{ column: 'b.id', value: id }, { column: 'b.status', value: 'enabled' }, { column: 'c.status', value: 'enabled' }] }));

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	if (!params.id && c.req.method === 'GET' && c.req.query('action') === 'discover') {
		if (text(c.req.query('field')) !== 'bucket') return apiMessage(c, 400, '不支持的发现字段');
		const credentialId = Number(c.req.query('cloud_credential_id'));
		const credential = Number.isInteger(credentialId) ? await loadCredential(database, credentialId) : null;
		if (!credential || !providerSupportsObjectStorage(credential.provider)) return apiMessage(c, 400, '凭据不支持对象存储');
		const defaults = getCloudDiscoveryDefaults(credential.provider, credential.account_id);
		const endpoint = text(c.req.query('endpoint')) || defaults.endpoints[0] || '';
		const region = text(c.req.query('region')) || defaults.regions[0] || '';
		if (!endpoint && credential.provider === 'other') return apiResponse(c, 200, { options: [] });
		try {
			const buckets = credential.provider === 'tencent'
				? await listTencentCosBuckets(credential)
				: credential.provider === 'aliyun'
					? await listAliyunOssBuckets(credential)
				: validEndpoint(endpoint)
					? await createCloudStorageAdapter({ id: 0, provider: credential.provider, cloud_credential_id: credential.id,
						endpoint, region, bucket: '', path_style: 1, public_base_url: '', extra_config: '{}',
						access_key_id: credential.access_key_id, access_key_secret: credential.access_key_secret }).listBuckets()
					: [];
			return apiResponse(c, 200, { options: buckets.map((item) => ({
				value: item.name,
				text: item.region ? `${item.name} (${item.region})` : item.name,
				fieldValues: getCloudBucketFieldValues(credential.provider, item.region || region, endpoint),
			})) });
		} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : 'Bucket 列表读取失败'); }
	}
	if (!params.id && c.req.method === 'GET') {
		const [rows, columns] = await Promise.all([
			allSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_cloud_object_storage_buckets', alias: 'b', columns: { id: 'b.id', cloud_credential_id: 'b.cloud_credential_id', credential_name: 'c.name', provider: 'c.provider', endpoint: 'b.endpoint', region: 'b.region', bucket: 'b.bucket', path_style: 'b.path_style', public_base_url: 'b.public_base_url', status: 'b.status', created_at: 'b.created_at', updated_at: 'b.updated_at' }, joins: [{ table: 'global_cloud_credentials', alias: 'c', left: 'c.id', right: 'b.cloud_credential_id' }], orderBy: [{ column: 'b.id', direction: 'DESC' }] })),
			columnsWithCredentials(database),
		]);
		const dataSource = rows.map((row) => ({ ...row, product: getCloudStorageProduct(String(row.provider)) }));
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'create', label: '新增' }, { key: 'delete', label: '删除' }], row: [{ key: 'test', label: '测试' }, { key: 'edit', label: '编辑' }, { key: 'delete', label: '删除' }] } }, columns, dataSource, totalRecords: dataSource.length } });
	}
	if (!params.id && c.req.method === 'POST') {
		const body = await parseBody(c);
		const credentialId = Number(body.cloud_credential_id), endpoint = text(body.endpoint), bucket = text(body.bucket);
		const credential = Number.isInteger(credentialId) ? await loadCredential(database, credentialId) : null;
		if (!credential || !providerSupportsObjectStorage(credential.provider) || !validEndpoint(endpoint) || !bucket) return apiMessage(c, 400, '凭据或 Bucket 配置不合法');
		const extra = parseExtra(body.extra_config);
		if (extra === null) return apiMessage(c, 400, '扩展配置必须是有效 JSON');
		try {
			const now = Date.now();
			await runSql(database, sql(database).insert('global_cloud_object_storage_buckets', { cloud_credential_id: credentialId, endpoint, region: text(body.region), bucket, path_style: booleanValue(body.path_style) ? 1 : 0, public_base_url: text(body.public_base_url), extra_config: extra, status: body.status === statusValues.disabled ? statusValues.disabled : statusValues.enabled, created_at: now, updated_at: now }));
		} catch { return apiMessage(c, 409, '该凭据、Endpoint 和 Bucket 已经存在'); }
		return apiMessageData(c, 201, 'Bucket 创建成功', {});
	}
	if (!params.id && c.req.method === 'DELETE') {
		const ids = await c.req.json<unknown>().catch(() => []);
		for (const id of Array.isArray(ids) ? ids : []) {
			try { await runSql(database, sql(database).delete('global_cloud_object_storage_buckets', { id: Number(id) })); }
			catch { return apiMessage(c, 409, 'Bucket 已绑定到站点，不能删除'); }
		}
		return apiMessage(c, 200, '删除成功');
	}
	if (params.id && c.req.method === 'GET') {
		const row = await firstSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_cloud_object_storage_buckets', where: [{ column: 'id', value: Number(params.id) }] }));
		return row ? apiResponse(c, 200, row) : apiMessage(c, 404, 'Bucket 不存在');
	}
	if (params.id && c.req.method === 'POST' && c.req.query('action') === 'test') {
		const target = await targetById(database, Number(params.id));
		if (!target) return apiMessage(c, 404, 'Bucket 不存在、已停用或凭据已停用');
		try { await createCloudStorageAdapter(target).test(); return apiMessage(c, 200, 'Bucket 测试成功'); }
		catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : 'Bucket 测试失败'); }
	}
	if (params.id && c.req.method === 'PUT') {
		const current = await firstSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_cloud_object_storage_buckets', where: [{ column: 'id', value: Number(params.id) }] }));
		if (!current) return apiMessage(c, 404, 'Bucket 不存在');
		const body = await parseBody(c);
		const fields = ['cloud_credential_id', 'endpoint', 'region', 'bucket', 'path_style', 'public_base_url', 'extra_config', 'status'];
		const changed = getChangedFields(body, fields);
		const credentialId = changed.has('cloud_credential_id') ? Number(body.cloud_credential_id) : Number(current.cloud_credential_id);
		const credential = Number.isInteger(credentialId) ? await loadCredential(database, credentialId) : null;
		const endpoint = changed.has('endpoint') ? text(body.endpoint) : String(current.endpoint);
		const bucket = changed.has('bucket') ? text(body.bucket) : String(current.bucket);
		if (!credential || !providerSupportsObjectStorage(credential.provider) || !validEndpoint(endpoint) || !bucket) return apiMessage(c, 400, '凭据或 Bucket 配置不合法');
		const extra = changed.has('extra_config') ? parseExtra(body.extra_config) : String(current.extra_config);
		if (extra === null) return apiMessage(c, 400, '扩展配置必须是有效 JSON');
		try {
			await runSql(database, sql(database).update('global_cloud_object_storage_buckets', { cloud_credential_id: credentialId, endpoint, region: changed.has('region') ? text(body.region) : current.region, bucket, path_style: changed.has('path_style') ? (booleanValue(body.path_style) ? 1 : 0) : current.path_style, public_base_url: changed.has('public_base_url') ? text(body.public_base_url) : current.public_base_url, extra_config: extra, status: changed.has('status') && body.status === statusValues.disabled ? statusValues.disabled : changed.has('status') ? statusValues.enabled : current.status, updated_at: Date.now() }, { id: Number(params.id) }));
		} catch { return apiMessage(c, 409, '该凭据、Endpoint 和 Bucket 已经存在'); }
		return apiMessage(c, 200, '保存成功');
	}
	if (params.id && c.req.method === 'DELETE') {
		try { await runSql(database, sql(database).delete('global_cloud_object_storage_buckets', { id: Number(params.id) })); }
		catch { return apiMessage(c, 409, 'Bucket 已绑定到站点，不能删除'); }
		return apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
