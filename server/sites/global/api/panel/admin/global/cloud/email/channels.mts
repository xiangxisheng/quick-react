import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { cloudProviderOptions, getCloudEmailProduct, getCloudEmailRegions, providerSupportsEmailPush } from '@server/cloud/catalog.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';

const columns = [
	{ dataIndex: 'cloud_credential_id', title: '云凭据', component: 'select', rules: [{ required: true, message: '请选择云凭据' }] },
	{ dataIndex: 'region', title: 'Region', component: 'select', options: getCloudEmailRegions('aliyun').map((value) => ({ value, text: value })), rules: [{ required: true, message: '请选择 Region' }] },
	{ dataIndex: 'account_name', title: '发信地址', component: 'textbox', rules: [{ required: true, message: '请输入已验证的发信地址' }, { type: 'email', message: '发信地址格式不正确' }] },
	{ dataIndex: 'from_alias', title: '发信人名称', component: 'textbox', rules: [{ required: true, message: '请输入发信人名称' }] },
	{ dataIndex: 'reply_to_address', title: '启用回信地址', component: 'switch' },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
];

const parseBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({}));
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const booleanValue = (value: unknown) => value === true || value === 1 || value === '1';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const credentialOptions = async (database: DatabaseAdapter) => {
	const rows = await database.prepare(`SELECT id, name, provider FROM global_cloud_credentials WHERE status = 'enabled' ORDER BY provider, name`)
		.all<{ id: number; name: string; provider: string }>();
	const names = new Map<string, string>(cloudProviderOptions.map((item) => [item.value, item.text]));
	return rows.results.filter((item) => providerSupportsEmailPush(item.provider))
		.map((item) => ({ value: String(item.id), text: `${item.name} (${names.get(item.provider) ?? item.provider})` }));
};
const validCredential = async (database: DatabaseAdapter, id: number, region: string) => {
	const credential = await database.prepare(`SELECT id, provider FROM global_cloud_credentials WHERE id = ?1 AND status = 'enabled'`)
		.bind(id).first<{ id: number; provider: string }>();
	return Boolean(credential && providerSupportsEmailPush(credential.provider) && getCloudEmailRegions(credential.provider).some((item) => item === region));
};
const deleteChannel = async (database: DatabaseAdapter, id: number) => {
	const row = await database.prepare(`SELECT id, status FROM global_cloud_email_channels WHERE id = ?1`).bind(id).first<{ id: number; status: string }>();
	if (!row) return '邮件通道不存在';
	if (row.status !== statusValues.disabled) return '邮件通道必须先停用才能删除';
	const association = await database.prepare(`SELECT channel_id FROM global_cloud_email_bindings WHERE channel_id = ?1
		UNION ALL SELECT channel_id FROM global_cloud_email_template_publications WHERE channel_id = ?1 LIMIT 1`).bind(id).first();
	if (association) return '邮件通道仍有站点绑定或模板发布记录，不能删除';
	await database.prepare(`DELETE FROM global_cloud_email_channels WHERE id = ?1`).bind(id).run();
};

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	if (!params.id && c.req.method === 'GET') {
		const [rows, options] = await Promise.all([
			database.prepare(`SELECT ch.id, ch.cloud_credential_id, c.name AS credential_name, c.provider, ch.region,
				ch.account_name, ch.from_alias, ch.reply_to_address, ch.status, ch.created_at, ch.updated_at
				FROM global_cloud_email_channels ch JOIN global_cloud_credentials c ON c.id = ch.cloud_credential_id ORDER BY ch.id DESC`).all<Record<string, unknown>>(),
			credentialOptions(database),
		]);
		const tableColumns = columns.map((column) => column.dataIndex === 'cloud_credential_id' ? { ...column, options } : column);
		const dataSource = rows.results.map((row) => ({ ...row, product: getCloudEmailProduct(String(row.provider)) }));
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'create', label: '新增' }, { key: 'delete', label: '删除' }], row: [{ key: 'edit', label: '编辑' }, { key: 'delete', label: '删除' }] } }, columns: tableColumns, dataSource, totalRecords: dataSource.length } });
	}
	if (!params.id && c.req.method === 'POST') {
		const body = await parseBody(c);
		const credentialId = Number(body.cloud_credential_id), region = text(body.region), accountName = text(body.account_name), fromAlias = text(body.from_alias);
		if (!Number.isInteger(credentialId) || !await validCredential(database, credentialId, region) || !emailPattern.test(accountName) || !fromAlias) return apiMessage(c, 400, '云凭据、Region 或发信身份不合法');
		try {
			await database.prepare(`INSERT INTO global_cloud_email_channels
				(cloud_credential_id, region, account_name, from_alias, reply_to_address, status, created_at, updated_at)
				VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`).bind(credentialId, region, accountName, fromAlias,
				booleanValue(body.reply_to_address) ? 1 : 0, body.status === statusValues.disabled ? statusValues.disabled : statusValues.enabled, Date.now()).run();
		} catch { return apiMessage(c, 409, '该凭据、Region 和发信地址已经存在'); }
		return apiMessageData(c, 201, '邮件通道创建成功', {});
	}
	if (!params.id && c.req.method === 'DELETE') {
		const ids = await c.req.json<unknown>().catch(() => []);
		for (const value of Array.isArray(ids) ? ids : []) {
			const error = await deleteChannel(database, Number(value));
			if (error) return apiMessage(c, 409, error);
		}
		return apiMessage(c, 200, '删除成功');
	}
	if (params.id && c.req.method === 'GET') {
		const row = await database.prepare(`SELECT id, cloud_credential_id, region, account_name, from_alias, reply_to_address,
			status, created_at, updated_at FROM global_cloud_email_channels WHERE id = ?1`).bind(Number(params.id)).first();
		return row ? apiResponse(c, 200, row) : apiMessage(c, 404, '邮件通道不存在');
	}
	if (params.id && c.req.method === 'PUT') {
		const current = await database.prepare(`SELECT id, cloud_credential_id, region, account_name, from_alias, reply_to_address, status
			FROM global_cloud_email_channels WHERE id = ?1`).bind(Number(params.id)).first<Record<string, unknown>>();
		if (!current) return apiMessage(c, 404, '邮件通道不存在');
		const body = await parseBody(c), changed = getChangedFields(body, ['cloud_credential_id', 'region', 'account_name', 'from_alias', 'reply_to_address', 'status']);
		const credentialId = changed.has('cloud_credential_id') ? Number(body.cloud_credential_id) : Number(current.cloud_credential_id);
		const region = changed.has('region') ? text(body.region) : String(current.region);
		const accountName = changed.has('account_name') ? text(body.account_name) : String(current.account_name);
		const fromAlias = changed.has('from_alias') ? text(body.from_alias) : String(current.from_alias);
		if (!Number.isInteger(credentialId) || !await validCredential(database, credentialId, region) || !emailPattern.test(accountName) || !fromAlias) return apiMessage(c, 400, '云凭据、Region 或发信身份不合法');
		const identityChanged = credentialId !== Number(current.cloud_credential_id) || region !== current.region || accountName !== current.account_name;
		if (identityChanged) {
			const publication = await database.prepare(`SELECT channel_id FROM global_cloud_email_template_publications WHERE channel_id = ?1 LIMIT 1`).bind(Number(params.id)).first();
			if (publication) return apiMessage(c, 409, '邮件通道已有模板发布记录，不能修改凭据、Region 或发信地址');
		}
		try {
			await database.prepare(`UPDATE global_cloud_email_channels SET cloud_credential_id = ?2, region = ?3, account_name = ?4,
				from_alias = ?5, reply_to_address = ?6, status = ?7, updated_at = ?8 WHERE id = ?1`).bind(Number(params.id), credentialId, region,
				accountName, fromAlias, changed.has('reply_to_address') ? (booleanValue(body.reply_to_address) ? 1 : 0) : current.reply_to_address,
				changed.has('status') && body.status === statusValues.disabled ? statusValues.disabled : changed.has('status') ? statusValues.enabled : current.status, Date.now()).run();
		} catch { return apiMessage(c, 409, '该凭据、Region 和发信地址已经存在'); }
		return apiMessage(c, 200, '保存成功');
	}
	if (params.id && c.req.method === 'DELETE') {
		const error = await deleteChannel(database, Number(params.id));
		return error ? apiMessage(c, 409, error) : apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
