import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { accountIdProviderKeys, cloudProviderKeys, cloudProviderOptions, isCredentialContextValid } from '@server/cloud/catalog.mjs';
import { testCloudCredential } from '@server/cloud/credential-test.mjs';
import type { CloudCredential } from '@server/cloud/index.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';

const columns = [
	{ dataIndex: 'id', title: 'ID', dataType: 'int' as const },
	{ dataIndex: 'name', title: '名称', component: 'textbox', rules: [{ required: true, message: '请输入名称' }] },
	{ dataIndex: 'provider', title: '供应商', component: 'select', options: cloudProviderOptions, rules: [{ required: true, message: '请选择供应商' }] },
	{ dataIndex: 'account_id', title: 'Account ID', component: 'textbox', dependsOn: 'provider', parentValues: accountIdProviderKeys, hideInTable: true, rules: [{ required: true, message: '请输入 Account ID' }] },
	{ dataIndex: 'access_key_id', title: 'Access Key ID', component: 'textbox', rules: [{ required: true, message: '请输入 Access Key ID' }] },
	{ dataIndex: 'access_key_secret', title: 'Access Key Secret', component: 'textbox', inputType: 'password', hideInTable: true, placeholder: '新增时必填；编辑时留空表示保持原值' },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
];

const parseBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({}));
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const publicRow = (row: Record<string, unknown>) => {
	const { access_key_secret: _secret, ...safe } = row;
	return safe;
};
const deleteCredential = async (database: DatabaseAdapter, id: number) => {
	const credential = await database.prepare('SELECT id, status FROM global_cloud_credentials WHERE id = ?1').bind(id).first<{ id: number; status: string }>();
	if (!credential) return '云凭据不存在';
	if (credential.status !== statusValues.disabled) return '云凭据必须先停用才能删除';
	const association = await database.prepare(`SELECT cloud_credential_id FROM global_cloud_object_storage_buckets WHERE cloud_credential_id = ?1
		UNION ALL SELECT cloud_credential_id FROM global_cloud_email_channels WHERE cloud_credential_id = ?1
		UNION ALL SELECT cloud_credential_id FROM global_cloud_email_template_publications WHERE cloud_credential_id = ?1 LIMIT 1`).bind(id).first();
	if (association) return '云凭据仍被 Bucket、邮件通道或云端模板使用，不能删除';
	await database.prepare('DELETE FROM global_cloud_credentials WHERE id = ?1').bind(id).run();
};

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	if (!params.id && c.req.method === 'GET') {
		const rows = await database.prepare(`SELECT id, name, provider, account_id, access_key_id, status, created_at, updated_at
			FROM global_cloud_credentials ORDER BY id DESC`).all<Record<string, unknown>>();
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'create', label: '新增' }, { key: 'delete', label: '删除' }], row: [{ key: 'test', label: '测试' }, { key: 'edit', label: '编辑' }, { key: 'delete', label: '删除' }] } }, columns, dataSource: rows.results.map(publicRow), totalRecords: rows.results.length } });
	}
	if (!params.id && c.req.method === 'POST') {
		const body = await parseBody(c);
		const name = text(body.name), provider = text(body.provider);
		const accountId = accountIdProviderKeys.includes(provider) ? text(body.account_id) : '';
		const accessKeyId = text(body.access_key_id), accessKeySecret = text(body.access_key_secret);
		if (!name || !cloudProviderKeys.has(provider) || !accessKeyId || !accessKeySecret) return apiMessage(c, 400, '名称、供应商和访问密钥必填');
		if (!isCredentialContextValid(provider, accountId)) return apiMessage(c, 400, 'Cloudflare Account ID 必须是 32 位十六进制字符串');
		try {
			await database.prepare(`INSERT INTO global_cloud_credentials
				(name, provider, account_id, access_key_id, access_key_secret, status, created_at, updated_at)
				VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`)
				.bind(name, provider, accountId, accessKeyId, accessKeySecret, body.status === statusValues.disabled ? statusValues.disabled : statusValues.enabled, Date.now()).run();
		} catch { return apiMessage(c, 409, '凭据名称已经存在'); }
		return apiMessageData(c, 201, '云凭据创建成功', {});
	}
	if (!params.id && c.req.method === 'DELETE') {
		const ids = await c.req.json<unknown>().catch(() => []);
		for (const id of Array.isArray(ids) ? ids : []) {
			const error = await deleteCredential(database, Number(id));
			if (error) return apiMessage(c, 409, error);
		}
		return apiMessage(c, 200, '删除成功');
	}
	if (params.id && c.req.method === 'GET') {
		const row = await database.prepare(`SELECT id, name, provider, account_id, access_key_id, status, created_at, updated_at
			FROM global_cloud_credentials WHERE id = ?1`).bind(Number(params.id)).first<Record<string, unknown>>();
		return row ? apiResponse(c, 200, publicRow(row)) : apiMessage(c, 404, '云凭据不存在');
	}
	if (params.id && c.req.method === 'POST' && c.req.query('action') === 'test') {
		const credential = await database.prepare(`SELECT id, name, provider, account_id, access_key_id, access_key_secret, status
			FROM global_cloud_credentials WHERE id = ?1 AND status = 'enabled'`).bind(Number(params.id)).first<CloudCredential>();
		if (!credential) return apiMessage(c, 404, '云凭据不存在或已停用');
		try {
			const result = await testCloudCredential(credential);
			if (result === null) return apiMessage(c, 200, '该自定义凭据暂不支持独立测试，请在 Bucket 配置中测试');
			if (result.aliyunIdentity) {
				const { accountId, identityType, principalId, arn, userId, roleId } = result.aliyunIdentity;
				const detail = [`账号 ID ${accountId}`, `身份类型 ${identityType}`, `主体 ID ${principalId}`, `ARN ${arn}`, userId ? `用户 ID ${userId}` : '', roleId ? `角色 ID ${roleId}` : ''].filter(Boolean).join('；');
				return apiMessageData(c, 200, `阿里云凭据测试成功：${detail}`, { identity: result.aliyunIdentity }, { component: 'modal', title: '阿里云凭据测试成功' });
			}
			if (result.tencentIdentity) {
				const { uin, ownerUin, appId } = result.tencentIdentity;
				return apiMessageData(c, 200, `腾讯云凭据测试成功：UIN ${uin}；OwnerUin ${ownerUin}；AppId ${appId}`, { identity: result.tencentIdentity }, { component: 'modal', title: '腾讯云凭据测试成功' });
			}
			return apiMessage(c, 200, result.bucketCount === undefined ? '凭据测试成功' : `凭据测试成功，发现 ${result.bucketCount} 个 Bucket`);
		} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : '凭据测试失败'); }
	}
	if (params.id && c.req.method === 'PUT') {
		const current = await database.prepare(`SELECT id, name, provider, account_id, access_key_id, access_key_secret, status
			FROM global_cloud_credentials WHERE id = ?1`).bind(Number(params.id)).first<Record<string, unknown>>();
		if (!current) return apiMessage(c, 404, '云凭据不存在');
		const body = await parseBody(c);
		const changed = getChangedFields(body, ['name', 'provider', 'account_id', 'access_key_id', 'access_key_secret', 'status']);
		const name = changed.has('name') ? text(body.name) : String(current.name);
		const provider = changed.has('provider') ? text(body.provider) : String(current.provider);
		const accountId = accountIdProviderKeys.includes(provider)
			? changed.has('account_id') ? text(body.account_id) : String(current.account_id)
			: '';
		const accessKeyId = changed.has('access_key_id') ? text(body.access_key_id) : String(current.access_key_id);
		if (!name || !cloudProviderKeys.has(provider) || !accessKeyId || !isCredentialContextValid(provider, accountId)) return apiMessage(c, 400, '名称、供应商、账号上下文或访问密钥不合法');
		if (changed.has('provider') && provider !== current.provider) {
			const inUse = await database.prepare(`SELECT cloud_credential_id FROM global_cloud_object_storage_buckets WHERE cloud_credential_id = ?1
				UNION ALL SELECT cloud_credential_id FROM global_cloud_email_channels WHERE cloud_credential_id = ?1
				UNION ALL SELECT cloud_credential_id FROM global_cloud_email_template_publications WHERE cloud_credential_id = ?1 LIMIT 1`).bind(Number(params.id)).first();
			if (inUse) return apiMessage(c, 409, '凭据已被 Bucket、邮件通道或云端模板使用，不能修改供应商');
		}
		const secret = changed.has('access_key_secret') && text(body.access_key_secret) ? text(body.access_key_secret) : String(current.access_key_secret ?? '');
		try {
			await database.prepare(`UPDATE global_cloud_credentials SET name = ?2, provider = ?3, account_id = ?4, access_key_id = ?5,
				access_key_secret = ?6, status = ?7, updated_at = ?8 WHERE id = ?1`)
				.bind(Number(params.id), name, provider, accountId, accessKeyId, secret,
					changed.has('status') && body.status === statusValues.disabled ? statusValues.disabled : changed.has('status') ? statusValues.enabled : current.status, Date.now()).run();
		} catch { return apiMessage(c, 409, '凭据名称已经存在'); }
		return apiMessage(c, 200, '保存成功');
	}
	if (params.id && c.req.method === 'DELETE') {
		const error = await deleteCredential(database, Number(params.id));
		return error ? apiMessage(c, 409, error) : apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
