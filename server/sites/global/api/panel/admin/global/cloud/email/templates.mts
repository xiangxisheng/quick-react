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
import { cloudProviderOptions, getCloudEmailRegionOptions, getCloudEmailRegions, providerSupportsEmailPush } from '@server/cloud/catalog.mjs';

const columns = [
	{ dataIndex: 'template_key', title: '模板 Key', component: 'textbox', placeholder: 'email_verification', rules: [{ required: true, message: '请输入模板 Key' }] },
	{ dataIndex: 'template_type', title: '类型', component: 'select', options: cloudEmailPurposeOptions, rules: [{ required: true, message: '请选择模板类型' }] },
	{ dataIndex: 'name', title: '名称', component: 'textbox', rules: [{ required: true, message: '请输入名称' }] },
	{ dataIndex: 'subject', title: '主题', component: 'textbox', placeholder: '您的验证码是 {{code}}', rules: [{ required: true, message: '请输入主题' }] },
	{ dataIndex: 'body_text', title: '纯文本正文', component: 'textarea', placeholder: '您的验证码是 {{code}}', rules: [{ required: true, message: '请输入纯文本正文' }] },
	{ dataIndex: 'body_html', title: 'HTML 正文', component: 'textarea', placeholder: '<p>您的验证码是 {{code}}</p>', rules: [{ required: true, message: '请输入 HTML 正文' }] },
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
const loadTemplate = (database: DatabaseAdapter, id: number) => database.prepare(`SELECT id, template_key, template_type, name, subject, body_text, body_html, status
	FROM global_cloud_email_templates WHERE id = ?1`).bind(id).first<CloudEmailTemplate>();
const savePublication = async (database: DatabaseAdapter, template: CloudEmailTemplate, target: CloudEmailScope) => {
	const contentHash = await cloudContentHash(template, target.provider);
	const current = await database.prepare(`SELECT provider_template_id, content_hash, status
		FROM global_cloud_email_template_publications WHERE template_id = ?1 AND cloud_credential_id = ?2 AND region = ?3`)
		.bind(template.id, target.cloud_credential_id, target.region).first<{ provider_template_id: string; content_hash: string; status: string }>();
	const contentUnchanged = current && (current.content_hash === contentHash
		|| (target.provider === 'aliyun' && current.content_hash === `legacy:${cloudContentSnapshot(template, target.provider)}`));
	let publicationStatus = current?.status;
	if (current && contentUnchanged && publicationStatus === 'reviewing') {
		const refreshed = await refreshCloudEmailTemplate(target, current.provider_template_id);
		publicationStatus = refreshed.status;
		await database.prepare(`UPDATE global_cloud_email_template_publications SET status = ?4, updated_at = ?5
			WHERE template_id = ?1 AND cloud_credential_id = ?2 AND region = ?3`)
			.bind(template.id, target.cloud_credential_id, target.region, publicationStatus, Date.now()).run();
	}
	if (current && contentUnchanged && (publicationStatus === 'ready' || publicationStatus === 'reviewing')) {
		if (current.content_hash !== contentHash) await database.prepare(`UPDATE global_cloud_email_template_publications SET content_hash = ?4
			WHERE template_id = ?1 AND cloud_credential_id = ?2 AND region = ?3`)
			.bind(template.id, target.cloud_credential_id, target.region, contentHash).run();
		return 'skipped' as const;
	}
	const publication = await publishCloudEmailTemplate(target, template, current?.provider_template_id);
	const now = Date.now();
	if (current) await database.prepare(`UPDATE global_cloud_email_template_publications SET provider_template_id = ?4, content_hash = ?5, status = ?6, updated_at = ?7
		WHERE template_id = ?1 AND cloud_credential_id = ?2 AND region = ?3`)
		.bind(template.id, target.cloud_credential_id, target.region, publication.providerTemplateId, contentHash, publication.status, now).run();
	else await database.prepare(`INSERT INTO global_cloud_email_template_publications
		(template_id, cloud_credential_id, region, provider_template_id, content_hash, status, created_at, updated_at)
		VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`)
		.bind(template.id, target.cloud_credential_id, target.region, publication.providerTemplateId, contentHash, publication.status, now).run();
	return 'submitted' as const;
};
const publishToEnabledScopes = async (database: DatabaseAdapter, template: CloudEmailTemplate) => {
	const scopes = await database.prepare(`SELECT DISTINCT c.provider, c.id AS cloud_credential_id, ch.region, c.access_key_id, c.access_key_secret
		FROM global_cloud_email_channels ch JOIN global_cloud_credentials c ON c.id = ch.cloud_credential_id
		WHERE ch.status = 'enabled' AND c.status = 'enabled'
		UNION
		SELECT c.provider, c.id AS cloud_credential_id, p.region, c.access_key_id, c.access_key_secret
		FROM global_cloud_email_template_publications p JOIN global_cloud_credentials c ON c.id = p.cloud_credential_id
		WHERE p.template_id = ?1 AND c.status = 'enabled'
		ORDER BY cloud_credential_id, region`).bind(template.id).all<CloudEmailScope>();
	const failures: string[] = [];
	let submitted = 0, skipped = 0;
	for (const scope of scopes.results) {
		try {
			const result = await savePublication(database, template, scope);
			if (result === 'submitted') submitted += 1;
			else skipped += 1;
		}
		catch (error) { failures.push(error instanceof Error ? error.message : `${scope.provider}/${scope.region} 模板发布失败`); }
	}
	return { failures, submitted, skipped };
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
			let local = await database.prepare(`SELECT p.template_id, t.template_type, t.subject, t.body_text FROM global_cloud_email_template_publications p
				JOIN global_cloud_email_templates t ON t.id = p.template_id
				WHERE p.provider_template_id = ?1 AND p.cloud_credential_id = ?2 AND p.region = ?3 LIMIT 1`)
				.bind(remote.providerTemplateId, target.cloud_credential_id, target.region).first<{ template_id: number; template_type: string; subject: string; body_text: string }>();
			if (!local) local = await database.prepare(`SELECT id AS template_id, template_type, subject, body_text FROM global_cloud_email_templates WHERE template_key = ?1`)
				.bind(importedTemplateKey(target.provider, target.cloud_credential_id, target.region, remote.providerTemplateId))
				.first<{ template_id: number; template_type: string; subject: string; body_text: string }>();
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
				await database.prepare(`UPDATE global_cloud_email_templates SET subject = ?2, body_text = ?3, body_html = ?4, updated_at = ?5 WHERE id = ?1`)
					.bind(local.template_id, subject, bodyText, bodyHtml, now).run();
				updated += 1;
			} else {
				const templateKey = importedTemplateKey(target.provider, target.cloud_credential_id, target.region, remote.providerTemplateId);
				await database.prepare(`INSERT INTO global_cloud_email_templates
					(template_key, template_type, name, subject, body_text, body_html, status, created_at, updated_at)
					VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'enabled', ?7, ?7)`)
					.bind(templateKey, templateType, remote.name, subject, bodyText, bodyHtml, now).run();
				local = await database.prepare('SELECT id AS template_id, template_type, subject, body_text FROM global_cloud_email_templates WHERE template_key = ?1')
					.bind(templateKey).first<{ template_id: number; template_type: string; subject: string; body_text: string }>();
				if (!local) throw new Error('本地模板创建后无法读取');
				imported += 1;
			}
			const synced = await loadTemplate(database, local.template_id);
			if (!synced) throw new Error('本地模板同步后无法读取');
			const contentHash = await cloudContentHash(synced, target.provider);
			const publication = await database.prepare(`SELECT template_id FROM global_cloud_email_template_publications
				WHERE template_id = ?1 AND cloud_credential_id = ?2 AND region = ?3`)
				.bind(local.template_id, target.cloud_credential_id, target.region).first();
			if (publication) await database.prepare(`UPDATE global_cloud_email_template_publications SET provider_template_id = ?4,
				content_hash = ?5, status = ?6, updated_at = ?7 WHERE template_id = ?1 AND cloud_credential_id = ?2 AND region = ?3`)
				.bind(local.template_id, target.cloud_credential_id, target.region, remote.providerTemplateId, contentHash, remote.status, now).run();
			else await database.prepare(`INSERT INTO global_cloud_email_template_publications
				(template_id, cloud_credential_id, region, provider_template_id, content_hash, status, created_at, updated_at)
				VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`)
				.bind(local.template_id, target.cloud_credential_id, target.region, remote.providerTemplateId, contentHash, remote.status, now).run();
		} catch (error) { failures.push(`${summary.name}：${error instanceof Error ? error.message : '同步失败'}`); }
	}
	return { imported, updated, total: remoteTemplates.length, failures };
};
const loadSyncOptions = async (database: DatabaseAdapter) => {
	const credentials = await database.prepare(`SELECT id, name, provider FROM global_cloud_credentials WHERE status = 'enabled' ORDER BY provider, name`)
		.all<{ id: number; name: string; provider: string }>();
	const providerNames = new Map<string, string>(cloudProviderOptions.map((item) => [item.value, item.text]));
	const enabled = credentials.results.filter((item) => providerSupportsEmailPush(item.provider));
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
	const row = await database.prepare(`SELECT id, status FROM global_cloud_email_templates WHERE id = ?1`).bind(id).first<{ id: number; status: string }>();
	if (!row) return '邮件模板不存在';
	if (row.status !== statusValues.disabled) return '邮件模板必须先停用才能删除';
	const association = await database.prepare(`SELECT template_id FROM global_cloud_email_bindings WHERE template_id = ?1
		UNION ALL SELECT template_id FROM global_cloud_email_template_publications WHERE template_id = ?1 LIMIT 1`).bind(id).first();
	if (association) return '邮件模板仍有站点绑定或云端发布记录，不能删除';
	await database.prepare(`DELETE FROM global_cloud_email_templates WHERE id = ?1`).bind(id).run();
};

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	if (!params.id && c.req.method === 'GET') {
		const [rows, syncOptions] = await Promise.all([
			database.prepare(`SELECT t.id, t.template_key, t.template_type, t.name, t.subject, t.body_text, t.body_html, t.status,
				t.created_at, t.updated_at, COALESCE(GROUP_CONCAT(p.status), '未发布') AS publication_status
				FROM global_cloud_email_templates t LEFT JOIN global_cloud_email_template_publications p ON p.template_id = t.id
				GROUP BY t.id, t.template_key, t.template_type, t.name, t.subject, t.body_text, t.body_html, t.status, t.created_at, t.updated_at ORDER BY t.id DESC`).all<Record<string, unknown>>(),
			loadSyncOptions(database),
		]);
		const syncColumns = [
			{ dataIndex: 'cloud_credential_id', title: '云凭据', component: 'select', options: syncOptions.credentials, rules: [{ required: true, message: '请选择云凭据' }] },
			{ dataIndex: 'region', title: 'Region', component: 'select', dependsOn: 'cloud_credential_id', options: syncOptions.regions, rules: [{ required: true, message: '请选择 Region' }] },
			{ dataIndex: 'template_type', title: '导入为模板类型', component: 'select', options: cloudEmailPurposeOptions, rules: [{ required: true, message: '请选择模板类型' }] },
		];
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'create', label: '新增' }, { key: 'sync', label: '同步模板', form: { columns: syncColumns } }, { key: 'delete', label: '删除' }], row: [{ key: 'restore', label: '还原默认', confirm: '确认用后端默认模板覆盖当前名称、主题和正文吗？' }, { key: 'publish', label: '发布/更新' }, { key: 'refresh', label: '刷新状态' }, { key: 'edit', label: '编辑' }, { key: 'delete', label: '删除' }] } }, columns, dataSource: rows.results, totalRecords: rows.results.length } });
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
			await database.prepare(`INSERT INTO global_cloud_email_templates
				(template_key, template_type, name, subject, body_text, body_html, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`)
				.bind(templateKey, templateType, name, subject, bodyText, bodyHtml, body.status === statusValues.disabled ? statusValues.disabled : statusValues.enabled, Date.now()).run();
		} catch { return apiMessage(c, 409, '模板 Key 已经存在'); }
		const template = await database.prepare(`SELECT id, template_key, template_type, name, subject, body_text, body_html, status FROM global_cloud_email_templates WHERE template_key = ?1`).bind(templateKey).first<CloudEmailTemplate>();
		if (!template) return apiMessage(c, 500, '模板创建后无法读取');
		const result = template.status === statusValues.enabled ? await publishToEnabledScopes(database, template) : { failures: [], submitted: 0, skipped: 0 };
		return apiMessageData(c, 201, result.failures.length ? `模板已创建，但有 ${result.failures.length} 个云端区域发布失败：${result.failures.join('；')}` : '邮件模板创建并提交云端审核成功', { id: template.id });
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
		const row = await database.prepare(`SELECT id, template_key, template_type, name, subject, body_text, body_html, status, created_at, updated_at
			FROM global_cloud_email_templates WHERE id = ?1`).bind(Number(params.id)).first();
		return row ? apiResponse(c, 200, row) : apiMessage(c, 404, '邮件模板不存在');
	}
	if (params.id && c.req.method === 'POST' && c.req.query('action') === 'publish') {
		const template = await loadTemplate(database, Number(params.id));
		if (!template || template.status !== statusValues.enabled) return apiMessage(c, 404, '邮件模板不存在或已停用');
		const result = await publishToEnabledScopes(database, template);
		if (result.failures.length) return apiMessage(c, 502, result.failures.join('；'));
		if (!result.submitted && result.skipped) return apiMessage(c, 200, '模板内容未改动，无需重新提交审核');
		return apiMessage(c, 200, result.skipped
			? `模板已提交 ${result.submitted} 个云端区域审核，跳过 ${result.skipped} 个未改动区域`
			: '模板已提交全部启用云端区域审核');
	}
	if (params.id && c.req.method === 'POST' && c.req.query('action') === 'refresh') {
		const publications = await database.prepare(`SELECT cloud_credential_id, region, provider_template_id FROM global_cloud_email_template_publications WHERE template_id = ?1`)
			.bind(Number(params.id)).all<{ cloud_credential_id: number; region: string; provider_template_id: string }>();
		if (!publications.results.length) return apiMessage(c, 404, '模板尚未发布到云端');
		const failures: string[] = [];
		for (const row of publications.results) {
			try {
				const target = await loadCloudEmailScope(database, row.cloud_credential_id, row.region);
				if (!target) throw new Error(`云凭据 ${row.cloud_credential_id} 不存在或已停用`);
				const publication = await refreshCloudEmailTemplate(target, row.provider_template_id);
				await database.prepare(`UPDATE global_cloud_email_template_publications SET status = ?4, updated_at = ?5
					WHERE template_id = ?1 AND cloud_credential_id = ?2 AND region = ?3`)
					.bind(Number(params.id), row.cloud_credential_id, row.region, publication.status, Date.now()).run();
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
		await database.prepare(`UPDATE global_cloud_email_templates SET name = ?2, subject = ?3, body_text = ?4,
			body_html = ?5, updated_at = ?6 WHERE id = ?1`).bind(current.id, defaults.name, defaults.subject, defaults.body_text, defaults.body_html, Date.now()).run();
		const restored = { ...current, ...defaults };
		const result = current.status === statusValues.enabled ? await publishToEnabledScopes(database, restored) : { failures: [], submitted: 0, skipped: 0 };
		return result.failures.length
			? apiMessage(c, 502, `本地模板已还原，但云端更新失败：${result.failures.join('；')}`)
			: apiMessage(c, 200, current.status === statusValues.enabled ? '模板已还原默认并提交云端审核' : '模板已还原默认');
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
			const binding = await database.prepare('SELECT template_id FROM global_cloud_email_bindings WHERE template_id = ?1 LIMIT 1').bind(current.id).first();
			if (binding) return apiMessage(c, 409, '模板已有站点绑定，不能修改类型');
		}
		try {
			await database.prepare(`UPDATE global_cloud_email_templates SET template_key = ?2, template_type = ?3, name = ?4, subject = ?5, body_text = ?6,
				body_html = ?7, status = ?8, updated_at = ?9 WHERE id = ?1`).bind(current.id, templateKey, templateType, name, subject, bodyText, bodyHtml, status, Date.now()).run();
		} catch { return apiMessage(c, 409, '模板 Key 已经存在'); }
		const updated = { ...current, template_key: templateKey, template_type: templateType, name, subject, body_text: bodyText, body_html: bodyHtml, status };
		const contentChanged = ['template_key', 'template_type', 'name', 'subject', 'body_text', 'body_html'].some((field) => changed.has(field));
		const result = status === statusValues.enabled && (contentChanged || current.status !== status)
			? await publishToEnabledScopes(database, updated)
			: { failures: [], submitted: 0, skipped: 0 };
		return result.failures.length ? apiMessage(c, 502, `本地模板已保存，但云端更新失败：${result.failures.join('；')}`) : apiMessage(c, 200, '保存成功');
	}
	if (params.id && c.req.method === 'DELETE') {
		const error = await deleteTemplate(database, Number(params.id));
		return error ? apiMessage(c, 409, error) : apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
