import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { cloudProviderOptions, getCloudEmailProduct, getCloudEmailRegionOptions, getCloudEmailRegions, providerSupportsEmailPush } from '@server/cloud/catalog.mjs';
import { listAliyunDirectMailAddresses } from '@server/cloud/providers/aliyun-direct-mail.mjs';
import { createCloudEmailAdapter, loadCloudEmailTarget, renderCloudEmailTemplate } from '@server/cloud/email.mjs';
import { validateCloudEmailTemplateVariables } from '@server/cloud/email-purposes.mjs';
import type { CloudCredential, CloudEmailTemplate } from '@server/cloud/index.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';

const columns = [
	{ dataIndex: 'cloud_credential_id', title: '云凭据', component: 'select', rules: [{ required: true, message: '请选择云凭据' }] },
	{ dataIndex: 'region', title: 'Region', component: 'select', options: getCloudEmailRegionOptions('aliyun').map((item) => ({ ...item, text: `${item.text}（${item.value}）` })), rules: [{ required: true, message: '请选择 Region' }] },
	{ dataIndex: 'account_name', title: '发信地址', component: 'select', remoteOptions: { action: 'discover', dependencies: ['cloud_credential_id', 'region'], clearFields: ['reply_to_address'] }, rules: [{ required: true, message: '请选择发信地址' }] },
	{ dataIndex: 'from_alias', title: '发信人名称', component: 'textbox', rules: [{ required: true, message: '请输入发信人名称' }] },
	{ dataIndex: 'reply_to_address', title: '启用回信地址', component: 'switch' },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
];
const testColumns = [
	{ dataIndex: 'to', title: '收件人', component: 'textbox', placeholder: 'recipient@example.com', rules: [{ required: true, message: '请输入收件人邮箱' }] },
	{ dataIndex: 'template_id', title: '邮箱验证码模板', component: 'select', remoteOptions: { action: 'templates', dependencies: [] }, rules: [{ required: true, message: '请选择已审核通过的模板' }] },
	{ dataIndex: 'code', title: '验证码内容', component: 'textbox', placeholder: '123456', rules: [{ required: true, message: '请输入 6 位数字验证码' }] },
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
const loadCredential = (database: DatabaseAdapter, id: number) => database.prepare(`SELECT id, name, provider, account_id,
	access_key_id, access_key_secret, status FROM global_cloud_credentials WHERE id = ?1 AND status = 'enabled'`).bind(id).first<CloudCredential>();
const deleteChannel = async (database: DatabaseAdapter, id: number) => {
	const row = await database.prepare(`SELECT id, status FROM global_cloud_email_channels WHERE id = ?1`).bind(id).first<{ id: number; status: string }>();
	if (!row) return '邮件通道不存在';
	if (row.status !== statusValues.disabled) return '邮件通道必须先停用才能删除';
	const association = await database.prepare(`SELECT channel_id FROM global_cloud_email_bindings WHERE channel_id = ?1 LIMIT 1`).bind(id).first();
	if (association) return '邮件通道仍有站点绑定，不能删除';
	await database.prepare(`DELETE FROM global_cloud_email_channels WHERE id = ?1`).bind(id).run();
};

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	if (!params.id && c.req.method === 'GET' && c.req.query('action') === 'discover') {
		if (text(c.req.query('field')) !== 'account_name') return apiMessage(c, 400, '不支持的发现字段');
		const credentialId = Number(c.req.query('cloud_credential_id'));
		const region = text(c.req.query('region'));
		const credential = Number.isInteger(credentialId) ? await loadCredential(database, credentialId) : null;
		if (!credential || credential.provider !== 'aliyun' || !getCloudEmailRegions(credential.provider).includes(region)) return apiMessage(c, 400, '阿里云凭据或 Region 不合法');
		try {
			const addresses = await listAliyunDirectMailAddresses({ region, access_key_id: credential.access_key_id, access_key_secret: credential.access_key_secret });
			return apiResponse(c, 200, { options: addresses.map((item) => ({
				value: item.accountName,
				text: item.accountName,
				fieldValues: { reply_to_address: item.replyEnabled },
			})) });
		} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : '阿里云发信地址读取失败'); }
	}
	if (!params.id && c.req.method === 'GET') {
		const [rows, options] = await Promise.all([
			database.prepare(`SELECT ch.id, ch.cloud_credential_id, c.name AS credential_name, c.provider, ch.region,
				ch.account_name, ch.from_alias, ch.reply_to_address, ch.status, ch.created_at, ch.updated_at
				FROM global_cloud_email_channels ch JOIN global_cloud_credentials c ON c.id = ch.cloud_credential_id ORDER BY ch.id DESC`).all<Record<string, unknown>>(),
			credentialOptions(database),
		]);
		const tableColumns = columns.map((column) => column.dataIndex === 'cloud_credential_id' ? { ...column, options } : column);
		const dataSource = rows.results.map((row) => ({ ...row, product: getCloudEmailProduct(String(row.provider)) }));
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'create', label: '新增' }, { key: 'delete', label: '删除' }], row: [{ key: 'test', label: '测试发件', form: { columns: testColumns } }, { key: 'edit', label: '编辑' }, { key: 'delete', label: '删除' }] } }, columns: tableColumns, dataSource, totalRecords: dataSource.length } });
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
	if (params.id && c.req.method === 'GET' && c.req.query('action') === 'templates') {
		if (text(c.req.query('field')) !== 'template_id') return apiMessage(c, 400, '不支持的发现字段');
		const channel = await loadCloudEmailTarget(database, Number(params.id));
		if (!channel) return apiMessage(c, 404, '邮件通道不存在或已停用');
		const templates = await database.prepare(`SELECT id, template_key, name, template_type, subject, body_text, body_html, status FROM global_cloud_email_templates
			WHERE status = 'enabled' AND template_type = 'email_verification' ORDER BY name, template_key`)
			.all<CloudEmailTemplate>();
		return apiResponse(c, 200, { options: templates.results.filter((item) => !validateCloudEmailTemplateVariables(item.template_type, item))
			.map((item) => ({ value: String(item.id), text: `${item.name} (${item.template_key})` })) });
	}
	if (params.id && c.req.method === 'GET') {
		const row = await database.prepare(`SELECT id, cloud_credential_id, region, account_name, from_alias, reply_to_address,
			status, created_at, updated_at FROM global_cloud_email_channels WHERE id = ?1`).bind(Number(params.id)).first();
		return row ? apiResponse(c, 200, row) : apiMessage(c, 404, '邮件通道不存在');
	}
	if (params.id && c.req.method === 'POST' && c.req.query('action') === 'test') {
		const body = await parseBody(c), to = text(body.to), templateId = Number(body.template_id), code = text(body.code);
		if (!emailPattern.test(to) || !Number.isInteger(templateId) || !/^\d{6}$/.test(code)) return apiMessage(c, 400, '收件人、验证码模板或 6 位数字验证码不合法');
		const [target, template] = await Promise.all([
			loadCloudEmailTarget(database, Number(params.id)),
			database.prepare(`SELECT id, template_key, template_type, name, subject, body_text, body_html, status
				FROM global_cloud_email_templates WHERE id = ?1 AND template_type = 'email_verification' AND status = 'enabled'`)
				.bind(templateId).first<CloudEmailTemplate>(),
		]);
		if (!target || !template) return apiMessage(c, 404, '邮件通道或启用的验证码模板不存在');
		const variableError = validateCloudEmailTemplateVariables(template.template_type, template);
		if (variableError) return apiMessage(c, 400, variableError);
		const variables = { code, email: to, expires_minutes: '10' };
		try {
			const rendered = renderCloudEmailTemplate(template, variables);
			const result = await createCloudEmailAdapter(target).send({ to, ...rendered });
			return apiMessageData(c, 200, '测试邮件已提交', { requestId: result.requestId, messageId: result.messageId }, { component: 'modal', title: '测试发件成功' });
		} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : '测试邮件发送失败'); }
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
			const binding = await database.prepare(`SELECT channel_id FROM global_cloud_email_bindings WHERE channel_id = ?1 LIMIT 1`).bind(Number(params.id)).first();
			if (binding) return apiMessage(c, 409, '邮件通道已有站点绑定，不能修改凭据、Region 或发信地址');
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
