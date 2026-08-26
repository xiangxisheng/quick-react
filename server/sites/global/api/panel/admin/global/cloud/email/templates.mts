import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { loadCloudEmailScope, publishCloudEmailTemplate, refreshCloudEmailTemplate } from '@server/cloud/email.mjs';
import { cloudEmailPurposeKeys, cloudEmailPurposeOptions, cloudEmailTemplateDefaults, validateCloudEmailTemplateVariables } from '@server/cloud/email-purposes.mjs';
import { getAliyunDirectMailTemplate, listAliyunDirectMailTemplates } from '@server/cloud/providers/aliyun-direct-mail.mjs';
import { getTencentSesTemplate, listTencentSesTemplates } from '@server/cloud/providers/tencent-ses.mjs';
import type { CloudEmailScope, CloudEmailTemplate } from '@server/cloud/index.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';
import { cloudProviderOptions, getCloudEmailRegionLabel, getCloudEmailRegionOptions, getCloudEmailRegions, providerSupportsEmailPush } from '@server/cloud/catalog.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';

const columns = [
	{ dataIndex: 'id', title: 'ID', dataType: 'int' as const },
	{ dataIndex: 'template_key', title: '模板 Key', component: 'textbox', placeholder: 'email_verification', rules: [{ required: true, message: '请输入模板 Key' }] },
	{ dataIndex: 'template_type', title: '类型', component: 'select', options: cloudEmailPurposeOptions, rules: [{ required: true, message: '请选择模板类型' }] },
	{ dataIndex: 'name', title: '名称', component: 'textbox', rules: [{ required: true, message: '请输入名称' }] },
	{ dataIndex: 'subject', title: '主题', component: 'textbox', placeholder: '您的验证码是 {{code}}', rules: [{ required: true, message: '请输入主题' }] },
	{ dataIndex: 'body_text', title: '纯文本正文', component: 'textarea', tableDisplay: 'multiline', placeholder: '您的验证码是 {{code}}', rules: [{ required: true, message: '请输入纯文本正文' }] },
	{ dataIndex: 'body_html', title: 'HTML 正文', component: 'textarea', tableDisplay: 'multiline', placeholder: '<p>您的验证码是 {{code}}</p>', rules: [{ required: true, message: '请输入 HTML 正文' }] },
	{ dataIndex: 'publication_status', title: '云端发布' },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
];

const keyPattern = /^[a-z][a-z0-9_]*$/;
const parseBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({}));
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const localTemplateText = (value: string) => value.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, '{{$1}}');
const plainText = (html: string) => html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
	.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p\s*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim() || '请查看 HTML 邮件内容';
const htmlText = (value: string) => `<p>${value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br>')}</p>`;
const importedTemplateKey = (provider: string, credentialId: number, region: string, providerTemplateId: string) => `${provider}_${credentialId}_${region}_${providerTemplateId}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
const encoder = new TextEncoder();
const cloudContentSnapshot = (template: CloudEmailTemplate, provider: string) => JSON.stringify(provider === 'tencent' ? [
	template.template_key,
	template.body_text,
	template.body_html,
] : [template.template_key, template.name, template.subject, template.body_html]);
const cloudContentHash = async (template: CloudEmailTemplate, provider: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(cloudContentSnapshot(template, provider))))]
	.map((byte) => byte.toString(16).padStart(2, '0')).join('');
const loadTemplate = (database: DatabaseAdapter, id: number) => firstSql<CloudEmailTemplate>(database, sql(database).select({ table: 'global_cloud_email_templates', where: [{ column: 'id', value: id }] }));
const savePublication = async (database: DatabaseAdapter, template: CloudEmailTemplate, target: CloudEmailScope) => {
	const contentHash = await cloudContentHash(template, target.provider);
	const current = await firstSql<{ provider_template_id: string; content_hash: string; status: string }>(database, sql(database).select({ table: 'global_cloud_email_template_publications', columns: { provider_template_id: 'provider_template_id', content_hash: 'content_hash', status: 'status' }, where: [{ column: 'template_id', value: template.id }, { column: 'cloud_credential_id', value: target.cloud_credential_id }, { column: 'region', value: target.region }] }));
	const contentUnchanged = current && (current.content_hash === contentHash
		|| (target.provider === 'aliyun' && current.content_hash === `legacy:${cloudContentSnapshot(template, target.provider)}`));
	let publicationStatus = current?.status;
	if (current && contentUnchanged && publicationStatus === 'reviewing') {
		const refreshed = await refreshCloudEmailTemplate(target, current.provider_template_id);
		publicationStatus = refreshed.status;
		await runSql(database, sql(database).update('global_cloud_email_template_publications', { status: publicationStatus, updated_at: Date.now() }, { template_id: template.id, cloud_credential_id: target.cloud_credential_id, region: target.region }));
	}
	if (current && contentUnchanged && (publicationStatus === 'ready' || publicationStatus === 'reviewing')) {
		if (current.content_hash !== contentHash) await runSql(database, sql(database).update('global_cloud_email_template_publications', { content_hash: contentHash }, { template_id: template.id, cloud_credential_id: target.cloud_credential_id, region: target.region }));
		return 'skipped' as const;
	}
	const publication = await publishCloudEmailTemplate(target, template, current?.provider_template_id);
	const now = Date.now();
	if (current) await runSql(database, sql(database).update('global_cloud_email_template_publications', { provider_template_id: publication.providerTemplateId, content_hash: contentHash, status: publication.status, updated_at: now }, { template_id: template.id, cloud_credential_id: target.cloud_credential_id, region: target.region }));
	else await runSql(database, sql(database).insert('global_cloud_email_template_publications', { template_id: template.id, cloud_credential_id: target.cloud_credential_id, region: target.region, provider_template_id: publication.providerTemplateId, content_hash: contentHash, status: publication.status, created_at: now, updated_at: now }));
	return 'submitted' as const;
};
const syncCloudTemplates = async (database: DatabaseAdapter, credentialId: number, region: string, templateType: string) => {
	const target = await loadCloudEmailScope(database, credentialId, region);
	if (!target || !providerSupportsEmailPush(target.provider) || !getCloudEmailRegions(target.provider).includes(region)) throw new Error('请选择有效的云凭据和 Region');
	const remoteTemplates = target.provider === 'aliyun' ? await listAliyunDirectMailTemplates(target) : await listTencentSesTemplates(target);
	let imported = 0, updated = 0;
	const failures: string[] = [];
	for (const summary of remoteTemplates) {
		try {
			const remote = target.provider === 'aliyun'
				? await getAliyunDirectMailTemplate(target, summary.providerTemplateId)
				: await getTencentSesTemplate(target, summary.providerTemplateId);
			let local = await firstSql<{ template_id: number; template_type: string; subject: string; body_text: string }>(database, sql(database).select({ table: 'global_cloud_email_template_publications', alias: 'p', columns: { template_id: 'p.template_id', template_type: 't.template_type', subject: 't.subject', body_text: 't.body_text' }, joins: [{ table: 'global_cloud_email_templates', alias: 't', left: 't.id', right: 'p.template_id' }], where: [{ column: 'p.provider_template_id', value: remote.providerTemplateId }, { column: 'p.cloud_credential_id', value: target.cloud_credential_id }, { column: 'p.region', value: target.region }], limit: 1 }));
			if (!local) local = await firstSql<{ template_id: number; template_type: string; subject: string; body_text: string }>(database, sql(database).select({ table: 'global_cloud_email_templates', columns: { template_id: 'id', template_type: 'template_type', subject: 'subject', body_text: 'body_text' }, where: [{ column: 'template_key', value: importedTemplateKey(target.provider, target.cloud_credential_id, target.region, remote.providerTemplateId) }] }));
			const normalize = target.provider === 'aliyun' ? localTemplateText : (value: string) => value;
			const effectiveType = local?.template_type ?? templateType;
			const remoteText = 'text' in remote ? normalize(remote.text) : '';
			const bodyHtml = normalize(remote.html) || htmlText(remoteText);
			const bodyText = remoteText || local?.body_text || plainText(bodyHtml);
			const subject = 'subject' in remote ? normalize(remote.subject) : local?.subject ?? cloudEmailTemplateDefaults[effectiveType]?.subject ?? '邮件通知 {{code}}';
			const now = Date.now();
			const variableError = validateCloudEmailTemplateVariables(effectiveType, { subject, body_text: bodyText, body_html: bodyHtml });
			if (variableError) throw new Error(variableError);
			if (local) {
				await runSql(database, sql(database).update('global_cloud_email_templates', { subject, body_text: bodyText, body_html: bodyHtml, updated_at: now }, { id: local.template_id }));
				updated += 1;
			} else {
				const templateKey = importedTemplateKey(target.provider, target.cloud_credential_id, target.region, remote.providerTemplateId);
				await runSql(database, sql(database).insert('global_cloud_email_templates', { template_key: templateKey, template_type: templateType, name: remote.name, subject, body_text: bodyText, body_html: bodyHtml, status: 'enabled', created_at: now, updated_at: now }));
				local = await firstSql<{ template_id: number; template_type: string; subject: string; body_text: string }>(database, sql(database).select({ table: 'global_cloud_email_templates', columns: { template_id: 'id', template_type: 'template_type', subject: 'subject', body_text: 'body_text' }, where: [{ column: 'template_key', value: templateKey }] }));
				if (!local) throw new Error('本地模板创建后无法读取');
				imported += 1;
			}
			const synced = await loadTemplate(database, local.template_id);
			if (!synced) throw new Error('本地模板同步后无法读取');
			const contentHash = await cloudContentHash(synced, target.provider);
			const publication = await firstSql(database, sql(database).select({ table: 'global_cloud_email_template_publications', columns: { template_id: 'template_id' }, where: [{ column: 'template_id', value: local.template_id }, { column: 'cloud_credential_id', value: target.cloud_credential_id }, { column: 'region', value: target.region }] }));
			if (publication) await runSql(database, sql(database).update('global_cloud_email_template_publications', { provider_template_id: remote.providerTemplateId, content_hash: contentHash, status: remote.status, updated_at: now }, { template_id: local.template_id, cloud_credential_id: target.cloud_credential_id, region: target.region }));
			else await runSql(database, sql(database).insert('global_cloud_email_template_publications', { template_id: local.template_id, cloud_credential_id: target.cloud_credential_id, region: target.region, provider_template_id: remote.providerTemplateId, content_hash: contentHash, status: remote.status, created_at: now, updated_at: now }));
		} catch (error) { failures.push(`${summary.name}：${error instanceof Error ? error.message : '同步失败'}`); }
	}
	return { imported, updated, total: remoteTemplates.length, failures };
};
const loadSyncOptions = async (database: DatabaseAdapter) => {
	const credentials = await allSql<{ id: number; name: string; provider: string }>(database, sql(database).select({ table: 'global_cloud_credentials', columns: { id: 'id', name: 'name', provider: 'provider' }, where: [{ column: 'status', value: 'enabled' }], orderBy: [{ column: 'provider' }, { column: 'name' }] }));
	const providerNames = new Map<string, string>(cloudProviderOptions.map((item) => [item.value, item.text]));
	const enabled = credentials.filter((item) => providerSupportsEmailPush(item.provider));
	return {
		credentials: enabled.map((item) => ({ value: String(item.id), text: `${item.name}（${providerNames.get(item.provider) ?? item.provider}）` })),
		regions: enabled.flatMap((credential) => getCloudEmailRegionOptions(credential.provider).map((region) => ({
			value: region.value,
			text: `${region.text}（${region.value}）`,
			parentValue: String(credential.id),
		}))),
	};
};
const deleteTemplate = async (database: DatabaseAdapter, id: number) => {
	const row = await firstSql<{ id: number; status: string }>(database, sql(database).select({ table: 'global_cloud_email_templates', columns: { id: 'id', status: 'status' }, where: [{ column: 'id', value: id }] }));
	if (!row) return '邮件模板不存在';
	if (row.status !== statusValues.disabled) return '邮件模板必须先停用才能删除';
	const association = (await Promise.all([
		firstSql(database, sql(database).select({ table: 'global_cloud_email_bindings', columns: { template_id: 'template_id' }, where: [{ column: 'template_id', value: id }], limit: 1 })),
		firstSql(database, sql(database).select({ table: 'global_cloud_email_template_publications', columns: { template_id: 'template_id' }, where: [{ column: 'template_id', value: id }], limit: 1 })),
	])).some(Boolean);
	if (association) return '邮件模板仍有站点绑定或云端发布记录，不能删除';
	await runSql(database, sql(database).delete('global_cloud_email_templates', { id }));
};

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	if (!params.id && c.req.method === 'GET') {
		const [templates, publications, syncOptions] = await Promise.all([
			allSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_cloud_email_templates', orderBy: [{ column: 'id', direction: 'DESC' }] })),
			allSql<{ template_id: number; status: string }>(database, sql(database).select({ table: 'global_cloud_email_template_publications', columns: { template_id: 'template_id', status: 'status' }, orderBy: [{ column: 'template_id' }] })),
			loadSyncOptions(database),
		]);
		const publicationMap = new Map<number, string[]>();
		for (const publication of publications) publicationMap.set(Number(publication.template_id), [...(publicationMap.get(Number(publication.template_id)) ?? []), publication.status]);
		const rows = templates.map((template) => ({ ...template, publication_status: publicationMap.get(Number(template.id))?.join(',') || '未发布' }));
		const scopeColumns = [
			{ dataIndex: 'cloud_credential_id', title: '云凭据', component: 'select', options: syncOptions.credentials, rules: [{ required: true, message: '请选择云凭据' }] },
			{ dataIndex: 'region', title: 'Region', component: 'select', dependsOn: 'cloud_credential_id', options: syncOptions.regions, rules: [{ required: true, message: '请选择 Region' }] },
		];
		const syncColumns = [
			...scopeColumns,
			{ dataIndex: 'template_type', title: '导入为模板类型', component: 'select', options: cloudEmailPurposeOptions, rules: [{ required: true, message: '请选择模板类型' }] },
		];
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'create', label: '新增' }, { key: 'sync', label: '同步模板', form: { columns: syncColumns } }, { key: 'delete', label: '删除' }], row: [{ key: 'restore', label: '还原默认', confirm: '确认用后端默认模板覆盖当前名称、主题和正文吗？' }, { key: 'publish', label: '发布/更新', form: { columns: scopeColumns } }, { key: 'refresh', label: '刷新状态' }, { key: 'edit', label: '编辑' }, { key: 'delete', label: '删除' }] } }, columns, dataSource: rows, totalRecords: rows.length } });
	}
	if (!params.id && c.req.method === 'POST' && c.req.query('action') === 'sync') {
		const body = await parseBody(c), credentialId = Number(body.cloud_credential_id), region = text(body.region), templateType = text(body.template_type);
		if (!Number.isInteger(credentialId) || !region || !cloudEmailPurposeKeys.has(templateType)) return apiMessage(c, 400, '云凭据、Region 或模板类型不合法');
		try {
			const result = await syncCloudTemplates(database, credentialId, region, templateType);
			const message = `云端模板同步完成：发现 ${result.total} 个，新增 ${result.imported} 个，更新 ${result.updated} 个${result.failures.length ? `，失败 ${result.failures.length} 个：${result.failures.join('；')}` : ''}`;
			return apiMessageData(c, 200, message, result, { component: 'modal', type: result.failures.length ? 'warning' : 'success', title: '模板同步' });
		} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : '模板同步失败'); }
	}
	if (!params.id && c.req.method === 'POST') {
		const body = await parseBody(c), templateKey = text(body.template_key), templateType = text(body.template_type), name = text(body.name), subject = text(body.subject), bodyText = text(body.body_text), bodyHtml = text(body.body_html);
		if (!keyPattern.test(templateKey) || !cloudEmailPurposeKeys.has(templateType) || !name || !subject || !bodyText || !bodyHtml) return apiMessage(c, 400, '模板 Key、类型、名称、主题和正文不合法');
		const variableError = validateCloudEmailTemplateVariables(templateType, { subject, body_text: bodyText, body_html: bodyHtml });
		if (variableError) return apiMessage(c, 400, variableError);
		try {
			const now = Date.now();
			await runSql(database, sql(database).insert('global_cloud_email_templates', { template_key: templateKey, template_type: templateType, name, subject, body_text: bodyText, body_html: bodyHtml, status: body.status === statusValues.disabled ? statusValues.disabled : statusValues.enabled, created_at: now, updated_at: now }));
		} catch { return apiMessage(c, 409, '模板 Key 已经存在'); }
		const template = await firstSql<CloudEmailTemplate>(database, sql(database).select({ table: 'global_cloud_email_templates', where: [{ column: 'template_key', value: templateKey }] }));
		if (!template) return apiMessage(c, 500, '模板创建后无法读取');
		return apiMessageData(c, 201, '邮件模板创建成功，请选择云凭据和 Region 发布', { id: template.id });
	}
	if (!params.id && c.req.method === 'DELETE') {
		const ids = await c.req.json<unknown>().catch(() => []);
		for (const value of Array.isArray(ids) ? ids : []) {
			const error = await deleteTemplate(database, Number(value));
			if (error) return apiMessage(c, 409, error);
		}
		return apiMessage(c, 200, '删除成功');
	}
	if (params.id && c.req.method === 'GET') {
		const row = await firstSql<Record<string, unknown>>(database, sql(database).select({ table: 'global_cloud_email_templates', where: [{ column: 'id', value: Number(params.id) }] }));
		return row ? apiResponse(c, 200, row) : apiMessage(c, 404, '邮件模板不存在');
	}
	if (params.id && c.req.method === 'POST' && c.req.query('action') === 'publish') {
		const template = await loadTemplate(database, Number(params.id));
		if (!template || template.status !== statusValues.enabled) return apiMessage(c, 404, '邮件模板不存在或已停用');
		const body = await parseBody(c), credentialId = Number(body.cloud_credential_id), region = text(body.region);
		if (!Number.isInteger(credentialId) || !region) return apiMessage(c, 400, '请选择云凭据和 Region');
		const target = await loadCloudEmailScope(database, credentialId, region);
		if (!target || !providerSupportsEmailPush(target.provider) || !getCloudEmailRegions(target.provider).includes(region)) return apiMessage(c, 400, '云凭据或 Region 不合法');
		try {
			const result = await savePublication(database, template, target);
			const providerName = cloudProviderOptions.find((item) => item.value === target.provider)?.text ?? target.provider;
			return apiMessage(c, 200, result === 'skipped' ? '模板内容未改动，无需重新提交审核'
				: `模板已提交到 ${providerName} / ${getCloudEmailRegionLabel(target.provider, target.region)}（${target.region}）审核`);
		} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : '模板发布失败'); }
	}
	if (params.id && c.req.method === 'POST' && c.req.query('action') === 'refresh') {
		const publications = await allSql<{ cloud_credential_id: number; region: string; provider_template_id: string }>(database, sql(database).select({ table: 'global_cloud_email_template_publications', columns: { cloud_credential_id: 'cloud_credential_id', region: 'region', provider_template_id: 'provider_template_id' }, where: [{ column: 'template_id', value: Number(params.id) }] }));
		if (!publications.length) return apiMessage(c, 404, '模板尚未发布到云端');
		const failures: string[] = [];
		for (const row of publications) {
			try {
				const target = await loadCloudEmailScope(database, row.cloud_credential_id, row.region);
				if (!target) throw new Error(`云凭据 ${row.cloud_credential_id} 不存在或已停用`);
				const publication = await refreshCloudEmailTemplate(target, row.provider_template_id);
				await runSql(database, sql(database).update('global_cloud_email_template_publications', { status: publication.status, updated_at: Date.now() }, { template_id: Number(params.id), cloud_credential_id: row.cloud_credential_id, region: row.region }));
			} catch (error) { failures.push(error instanceof Error ? error.message : `${row.cloud_credential_id}/${row.region} 状态刷新失败`); }
		}
		return failures.length ? apiMessage(c, 502, failures.join('；')) : apiMessage(c, 200, '云端模板状态已刷新');
	}
	if (params.id && c.req.method === 'POST' && c.req.query('action') === 'restore') {
		const current = await loadTemplate(database, Number(params.id));
		if (!current) return apiMessage(c, 404, '邮件模板不存在');
		const defaults = cloudEmailTemplateDefaults[current.template_type];
		if (!defaults) return apiMessage(c, 400, '该模板类型没有后端默认值');
		const variableError = validateCloudEmailTemplateVariables(current.template_type, defaults);
		if (variableError) return apiMessage(c, 500, `后端默认模板配置错误：${variableError}`);
		await runSql(database, sql(database).update('global_cloud_email_templates', { name: defaults.name, subject: defaults.subject, body_text: defaults.body_text, body_html: defaults.body_html, updated_at: Date.now() }, { id: current.id }));
		return apiMessage(c, 200, '模板已还原默认，请选择云凭据和 Region 发布更新');
	}
	if (params.id && c.req.method === 'PUT') {
		const current = await loadTemplate(database, Number(params.id));
		if (!current) return apiMessage(c, 404, '邮件模板不存在');
		const body = await parseBody(c), changed = getChangedFields(body, ['template_key', 'template_type', 'name', 'subject', 'body_text', 'body_html', 'status']);
		const templateKey = changed.has('template_key') ? text(body.template_key) : current.template_key;
		const templateType = changed.has('template_type') ? text(body.template_type) : current.template_type;
		const name = changed.has('name') ? text(body.name) : current.name, subject = changed.has('subject') ? text(body.subject) : current.subject;
		const bodyText = changed.has('body_text') ? text(body.body_text) : current.body_text, bodyHtml = changed.has('body_html') ? text(body.body_html) : current.body_html;
		const status = changed.has('status') && body.status === statusValues.disabled ? statusValues.disabled : changed.has('status') ? statusValues.enabled : current.status;
		if (!keyPattern.test(templateKey) || !cloudEmailPurposeKeys.has(templateType) || !name || !subject || !bodyText || !bodyHtml) return apiMessage(c, 400, '模板 Key、类型、名称、主题和正文不合法');
		const variableError = validateCloudEmailTemplateVariables(templateType, { subject, body_text: bodyText, body_html: bodyHtml });
		if (variableError) return apiMessage(c, 400, variableError);
		if (templateType !== current.template_type) {
			const binding = await firstSql(database, sql(database).select({ table: 'global_cloud_email_bindings', columns: { template_id: 'template_id' }, where: [{ column: 'template_id', value: current.id }], limit: 1 }));
			if (binding) return apiMessage(c, 409, '模板已有站点绑定，不能修改类型');
		}
		try {
			await runSql(database, sql(database).update('global_cloud_email_templates', { template_key: templateKey, template_type: templateType, name, subject, body_text: bodyText, body_html: bodyHtml, status, updated_at: Date.now() }, { id: current.id }));
		} catch { return apiMessage(c, 409, '模板 Key 已经存在'); }
		return apiMessage(c, 200, '保存成功，请按需选择云凭据和 Region 发布更新');
	}
	if (params.id && c.req.method === 'DELETE') {
		const error = await deleteTemplate(database, Number(params.id));
		return error ? apiMessage(c, 409, error) : apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
