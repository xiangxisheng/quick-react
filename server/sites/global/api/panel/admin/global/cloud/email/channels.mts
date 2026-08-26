import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { cloudProviderOptions, getCloudEmailProduct, getCloudEmailRegionOptions, getCloudEmailRegions, providerSupportsEmailPush } from '@server/cloud/catalog.mjs';
import { listAliyunDirectMailAddresses } from '@server/cloud/providers/aliyun-direct-mail.mjs';
import { listTencentSesAddresses } from '@server/cloud/providers/tencent-ses.mjs';
import { createCloudEmailAdapter, loadCloudEmailTarget, renderCloudEmailTemplate } from '@server/cloud/email.mjs';
import { validateCloudEmailTemplateVariables } from '@server/cloud/email-purposes.mjs';
import type { CloudCredential, CloudEmailTemplate } from '@server/cloud/index.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';

const columns = [
	{ dataIndex: 'id', title: 'ID', dataType: 'int' as const },
	{ dataIndex: 'cloud_credential_id', title: '云凭据', component: 'select', tableDisplay: 'reference', tableDisplayTextField: 'credential_name', rules: [{ required: true, message: '请选择云凭据' }] },
	{ dataIndex: 'region', title: 'Region', component: 'select', dependsOn: 'cloud_credential_id', rules: [{ required: true, message: '请选择 Region' }] },
	{ dataIndex: 'account_name', title: '发信地址', component: 'select', remoteOptions: { action: 'discover', dependencies: ['cloud_credential_id', 'region'], clearFields: ['reply_to_address'] }, rules: [{ required: true, message: '请选择发信地址' }] },
	{ dataIndex: 'from_alias', title: '发信人名称', component: 'textbox', rules: [{ required: true, message: '请输入发信人名称' }] },
	{ dataIndex: 'reply_to_address', title: '启用回信地址', component: 'switch' },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
];
const testColumns = [
	{ dataIndex: 'to', title: '收件人', component: 'textbox', placeholder: 'recipient@example.com', rules: [{ required: true, message: '请输入收件人邮箱' }] },
	{ dataIndex: 'template_id', title: '邮箱验证码模板', component: 'select', remoteOptions: { action: 'templates', dependencies: [] }, rules: [{ required: true, message: '请选择验证码模板' }] },
	{ dataIndex: 'code', title: '验证码内容', component: 'textbox', placeholder: '123456', rules: [{ required: true, message: '请输入 6 位数字验证码' }] },
];

const parseBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({}));
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const booleanValue = (value: unknown) => value === true || value === 1 || value === '1';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const credentialOptions = async (database: DatabaseAdapter) => {
	const rows = await allSql<{ id: number; name: string; provider: string }>(database, sql(database).select({ table: 'global_cloud_credentials', columns: { id: 'id', name: 'name', provider: 'provider' }, where: [{ column: 'status', value: 'enabled' }], orderBy: [{ column: 'provider' }, { column: 'name' }] }));
	const names = new Map<string, string>(cloudProviderOptions.map((item) => [item.value, item.text]));
	const enabled = rows.filter((item) => providerSupportsEmailPush(item.provider));
	return {
		credentials: enabled.map((item) => ({ value: String(item.id), text: `${item.name} (${names.get(item.provider) ?? item.provider})` })),
		regions: enabled.flatMap((credential) => getCloudEmailRegionOptions(credential.provider).map((region) => ({
			value: region.value, text: `${region.text}（${region.value}）`, parentValue: String(credential.id),
		}))),
	};
};
const validCredential = async (database: DatabaseAdapter, id: number, region: string) => {
	const credential = await firstSql<{ id: number; provider: string }>(database, sql(database).select({ table: 'global_cloud_credentials', columns: { id: 'id', provider: 'provider' }, where: [{ column: 'id', value: id }, { column: 'status', value: 'enabled' }] }));
	return Boolean(credential && providerSupportsEmailPush(credential.provider) && getCloudEmailRegions(credential.provider).some((item) => item === region));
};
const loadCredential = (database: DatabaseAdapter, id: number) => firstSql<CloudCredential>(database, sql(database).select({ table: 'global_cloud_credentials', where: [{ column: 'id', value: id }, { column: 'status', value: 'enabled' }] }));
const deleteChannel = async (database: DatabaseAdapter, id: number) => {
	const row = await firstSql<{ id: number; status: string }>(database, sql(database).select({ table: 'global_cloud_email_channels', columns: { id: 'id', status: 'status' }, where: [{ column: 'id', value: id }] }));
	if (!row) return '邮件通道不存在';
	if (row.status !== statusValues.disabled) return '邮件通道必须先停用才能删除';
	const association = await firstSql(database, sql(database).select({ table: 'global_cloud_email_bindings', columns: { channel_id: 'channel_id' }, where: [{ column: 'channel_id', value: id }], limit: 1 }));
	if (association) return '邮件通道仍有站点绑定，不能删除';
	await runSql(database, sql(database).delete('global_cloud_email_channels', { id }));
};

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	if (!params.id && c.req.method === 'GET' && c.req.query('action') === 'discover') {
		if (text(c.req.query('field')) !== 'account_name') return apiMessage(c, 400, '不支持的发现字段');
		const credentialId = Number(c.req.query('cloud_credential_id'));
		const region = text(c.req.query('region'));
		const credential = Number.isInteger(credentialId) ? await loadCredential(database, credentialId) : null;
		if (!credential || !providerSupportsEmailPush(credential.provider) || !getCloudEmailRegions(credential.provider).includes(region)) return apiMessage(c, 400, '云凭据或 Region 不合法');
		try {
			const scope = { provider: credential.provider, cloud_credential_id: credential.id, region, access_key_id: credential.access_key_id, access_key_secret: credential.access_key_secret };
			const addresses = credential.provider === 'aliyun'
				? (await listAliyunDirectMailAddresses(scope)).map((item) => ({ ...item, senderName: '', replyEnabled: item.replyEnabled }))
				: (await listTencentSesAddresses(scope)).map((item) => ({ ...item, replyEnabled: false }));
			return apiResponse(c, 200, { options: addresses.map((item) => ({
				value: item.accountName,
				text: item.accountName,
				fieldValues: { ...(item.senderName ? { from_alias: item.senderName } : {}), reply_to_address: item.replyEnabled },
			})) });
		} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : '云端发信地址读取失败'); }
	}
	if (!params.id && c.req.method === 'GET') {
		const [rows, options] = await Promise.all([
			allSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_cloud_email_channels', alias: 'ch', columns: { id: 'ch.id', cloud_credential_id: 'ch.cloud_credential_id', credential_name: 'c.name', provider: 'c.provider', region: 'ch.region', account_name: 'ch.account_name', from_alias: 'ch.from_alias', reply_to_address: 'ch.reply_to_address', status: 'ch.status', created_at: 'ch.created_at', updated_at: 'ch.updated_at' }, joins: [{ table: 'global_cloud_credentials', alias: 'c', left: 'c.id', right: 'ch.cloud_credential_id' }], orderBy: [{ column: 'ch.id', direction: 'DESC' }] })),
			credentialOptions(database),
		]);
		const tableColumns = columns.map((column) => column.dataIndex === 'cloud_credential_id' ? { ...column, options: options.credentials }
			: column.dataIndex === 'region' ? { ...column, options: options.regions } : column);
		const dataSource = rows.map((row) => ({ ...row, product: getCloudEmailProduct(String(row.provider)) }));
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'create', label: '新增' }, { key: 'delete', label: '删除' }], row: [{ key: 'test', label: '测试发件', form: { columns: testColumns } }, { key: 'edit', label: '编辑' }, { key: 'delete', label: '删除' }] } }, columns: tableColumns, dataSource, totalRecords: dataSource.length } });
	}
	if (!params.id && c.req.method === 'POST') {
		const body = await parseBody(c);
		const credentialId = Number(body.cloud_credential_id), region = text(body.region), accountName = text(body.account_name), fromAlias = text(body.from_alias);
		if (!Number.isInteger(credentialId) || !await validCredential(database, credentialId, region) || !emailPattern.test(accountName) || !fromAlias) return apiMessage(c, 400, '云凭据、Region 或发信身份不合法');
		try {
			const now = Date.now();
			await runSql(database, sql(database).insert('global_cloud_email_channels', { cloud_credential_id: credentialId, region, account_name: accountName, from_alias: fromAlias, reply_to_address: booleanValue(body.reply_to_address) ? 1 : 0, status: body.status === statusValues.disabled ? statusValues.disabled : statusValues.enabled, created_at: now, updated_at: now }));
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
		const [templates, publications] = await Promise.all([
			allSql<CloudEmailTemplate>(database, sql(database).select({ table: 'global_cloud_email_templates', where: [{ column: 'status', value: 'enabled' }, { column: 'template_type', value: 'email_verification' }], orderBy: [{ column: 'name' }, { column: 'template_key' }] })),
			allSql<{ template_id: number; status: string }>(database, sql(database).select({ table: 'global_cloud_email_template_publications', columns: { template_id: 'template_id', status: 'status' }, where: [{ column: 'cloud_credential_id', value: channel.cloud_credential_id }, { column: 'region', value: channel.region }] })),
		]);
		const publicationStatuses = new Map(publications.map((item) => [Number(item.template_id), item.status]));
		return apiResponse(c, 200, { options: templates.map((item) => ({ ...item, publication_status: publicationStatuses.get(Number(item.id)) })).filter((item) => !validateCloudEmailTemplateVariables(item.template_type, item)
			&& (channel.provider !== 'tencent' || item.publication_status === 'ready'))
			.map((item) => ({ value: String(item.id), text: `${item.name} (${item.template_key})` })) });
	}
	if (params.id && c.req.method === 'GET') {
		const row = await firstSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_cloud_email_channels', where: [{ column: 'id', value: Number(params.id) }] }));
		return row ? apiResponse(c, 200, row) : apiMessage(c, 404, '邮件通道不存在');
	}
	if (params.id && c.req.method === 'POST' && c.req.query('action') === 'test') {
		const body = await parseBody(c), to = text(body.to), templateId = Number(body.template_id), code = text(body.code);
		if (!emailPattern.test(to) || !Number.isInteger(templateId) || !/^\d{6}$/.test(code)) return apiMessage(c, 400, '收件人、验证码模板或 6 位数字验证码不合法');
		const [target, template] = await Promise.all([
			loadCloudEmailTarget(database, Number(params.id)),
			firstSql<CloudEmailTemplate>(database, sql(database).select({ table: 'global_cloud_email_templates', where: [{ column: 'id', value: templateId }, { column: 'template_type', value: 'email_verification' }, { column: 'status', value: 'enabled' }] })),
		]);
		if (!target || !template) return apiMessage(c, 404, '邮件通道或启用的验证码模板不存在');
		const variableError = validateCloudEmailTemplateVariables(template.template_type, template);
		if (variableError) return apiMessage(c, 400, variableError);
		const variables = { code, email: to, expires_minutes: '10' };
		try {
			const rendered = renderCloudEmailTemplate(template, variables);
			let providerTemplateId: string | undefined;
			if (target.provider === 'tencent') {
				const publication = await firstSql<{ provider_template_id: string }>(database, sql(database).select({ table: 'global_cloud_email_template_publications', columns: { provider_template_id: 'provider_template_id' }, where: [{ column: 'template_id', value: template.id }, { column: 'cloud_credential_id', value: target.cloud_credential_id }, { column: 'region', value: target.region }, { column: 'status', value: 'ready' }] }));
				if (!publication) return apiMessage(c, 400, '腾讯云 SES 测试发件需要已审核通过的云端模板');
				providerTemplateId = publication.provider_template_id;
			}
			const result = await createCloudEmailAdapter(target).send({ to, ...rendered, ...(providerTemplateId ? { template: { providerTemplateId, variables } } : {}) });
			return apiMessageData(c, 200, '测试邮件已提交', { requestId: result.requestId, messageId: result.messageId }, { component: 'modal', title: '测试发件成功' });
		} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : '测试邮件发送失败'); }
	}
	if (params.id && c.req.method === 'PUT') {
		const current = await firstSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_cloud_email_channels', where: [{ column: 'id', value: Number(params.id) }] }));
		if (!current) return apiMessage(c, 404, '邮件通道不存在');
		const body = await parseBody(c), changed = getChangedFields(body, ['cloud_credential_id', 'region', 'account_name', 'from_alias', 'reply_to_address', 'status']);
		const credentialId = changed.has('cloud_credential_id') ? Number(body.cloud_credential_id) : Number(current.cloud_credential_id);
		const region = changed.has('region') ? text(body.region) : String(current.region);
		const accountName = changed.has('account_name') ? text(body.account_name) : String(current.account_name);
		const fromAlias = changed.has('from_alias') ? text(body.from_alias) : String(current.from_alias);
		if (!Number.isInteger(credentialId) || !await validCredential(database, credentialId, region) || !emailPattern.test(accountName) || !fromAlias) return apiMessage(c, 400, '云凭据、Region 或发信身份不合法');
		const identityChanged = credentialId !== Number(current.cloud_credential_id) || region !== current.region || accountName !== current.account_name;
		if (identityChanged) {
			const binding = await firstSql(database, sql(database).select({ table: 'global_cloud_email_bindings', columns: { channel_id: 'channel_id' }, where: [{ column: 'channel_id', value: Number(params.id) }], limit: 1 }));
			if (binding) return apiMessage(c, 409, '邮件通道已有站点绑定，不能修改凭据、Region 或发信地址');
		}
		try {
			await runSql(database, sql(database).update('global_cloud_email_channels', { cloud_credential_id: credentialId, region, account_name: accountName, from_alias: fromAlias, reply_to_address: changed.has('reply_to_address') ? (booleanValue(body.reply_to_address) ? 1 : 0) : current.reply_to_address, status: changed.has('status') && body.status === statusValues.disabled ? statusValues.disabled : changed.has('status') ? statusValues.enabled : current.status, updated_at: Date.now() }, { id: Number(params.id) }));
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
