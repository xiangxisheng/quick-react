import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { loadCloudEmailTarget, publishCloudEmailTemplate, refreshCloudEmailTemplate } from '@server/cloud/email.mjs';
import { cloudEmailPurposeKeys, cloudEmailPurposeOptions, cloudEmailTemplateDefaults, validateCloudEmailTemplateVariables } from '@server/cloud/email-purposes.mjs';
import { getAliyunDirectMailTemplate, listAliyunDirectMailTemplates } from '@server/cloud/providers/aliyun-direct-mail.mjs';
import type { CloudEmailTemplate } from '@server/cloud/index.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';
import { getCloudEmailRegionLabel } from '@server/cloud/catalog.mjs';

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
const importedTemplateKey = (credentialId: number, providerTemplateId: string) => `aliyun_${credentialId}_${providerTemplateId}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
const loadTemplate = (database: DatabaseAdapter, id: number) => database.prepare(`SELECT id, template_key, template_type, name, subject, body_text, body_html, status
	FROM global_cloud_email_templates WHERE id = ?1`).bind(id).first<CloudEmailTemplate>();
const savePublication = async (database: DatabaseAdapter, template: CloudEmailTemplate, channelId: number) => {
	const target = await loadCloudEmailTarget(database, channelId);
	if (!target) throw new Error(`邮件通道 ${channelId} 不存在或已停用`);
	const current = await database.prepare(`SELECT provider_template_id FROM global_cloud_email_template_publications WHERE template_id = ?1 AND channel_id = ?2`)
		.bind(template.id, channelId).first<{ provider_template_id: string }>();
	const publication = await publishCloudEmailTemplate(target, template, current?.provider_template_id);
	const now = Date.now();
	if (current) await database.prepare(`UPDATE global_cloud_email_template_publications SET provider_template_id = ?3, status = ?4, updated_at = ?5
		WHERE template_id = ?1 AND channel_id = ?2`).bind(template.id, channelId, publication.providerTemplateId, publication.status, now).run();
	else await database.prepare(`INSERT INTO global_cloud_email_template_publications
		(template_id, channel_id, provider_template_id, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)`)
		.bind(template.id, channelId, publication.providerTemplateId, publication.status, now).run();
};
const publishToEnabledChannels = async (database: DatabaseAdapter, template: CloudEmailTemplate) => {
	const channels = await database.prepare(`SELECT id FROM global_cloud_email_channels WHERE status = 'enabled' ORDER BY id`).all<{ id: number }>();
	const failures: string[] = [];
	for (const channel of channels.results) {
		try { await savePublication(database, template, channel.id); }
		catch (error) { failures.push(error instanceof Error ? error.message : `邮件通道 ${channel.id} 发布失败`); }
	}
	return failures;
};
const syncAliyunTemplates = async (database: DatabaseAdapter, channelId: number, templateType: string) => {
	const target = await loadCloudEmailTarget(database, channelId);
	if (!target || target.provider !== 'aliyun') throw new Error('请选择已启用的阿里云邮件通道');
	const remoteTemplates = await listAliyunDirectMailTemplates(target);
	let imported = 0, updated = 0;
	const failures: string[] = [];
	for (const summary of remoteTemplates) {
		try {
			const remote = await getAliyunDirectMailTemplate(target, summary.providerTemplateId);
			let local = await database.prepare(`SELECT p.template_id, t.template_type, t.body_text FROM global_cloud_email_template_publications p
				JOIN global_cloud_email_channels ch ON ch.id = p.channel_id
				JOIN global_cloud_email_templates t ON t.id = p.template_id
				WHERE p.provider_template_id = ?1 AND ch.cloud_credential_id = ?2 LIMIT 1`)
				.bind(remote.providerTemplateId, target.cloud_credential_id).first<{ template_id: number; template_type: string; body_text: string }>();
			if (!local) local = await database.prepare(`SELECT id AS template_id, template_type, body_text FROM global_cloud_email_templates WHERE template_key = ?1`)
				.bind(importedTemplateKey(target.cloud_credential_id, remote.providerTemplateId)).first<{ template_id: number; template_type: string; body_text: string }>();
			const now = Date.now(), subject = localTemplateText(remote.subject), bodyHtml = localTemplateText(remote.html);
			const effectiveType = local?.template_type ?? templateType, bodyText = local?.body_text ?? plainText(bodyHtml);
			const variableError = validateCloudEmailTemplateVariables(effectiveType, { subject, body_text: bodyText, body_html: bodyHtml });
			if (variableError) throw new Error(variableError);
			if (local) {
				await database.prepare(`UPDATE global_cloud_email_templates SET subject = ?2, body_html = ?3, updated_at = ?4 WHERE id = ?1`)
					.bind(local.template_id, subject, bodyHtml, now).run();
				updated += 1;
			} else {
				const templateKey = importedTemplateKey(target.cloud_credential_id, remote.providerTemplateId);
				await database.prepare(`INSERT INTO global_cloud_email_templates
					(template_key, template_type, name, subject, body_text, body_html, status, created_at, updated_at)
					VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'enabled', ?7, ?7)`)
					.bind(templateKey, templateType, remote.name, subject, bodyText, bodyHtml, now).run();
				local = await database.prepare('SELECT id AS template_id, template_type, body_text FROM global_cloud_email_templates WHERE template_key = ?1')
					.bind(templateKey).first<{ template_id: number; template_type: string; body_text: string }>();
				if (!local) throw new Error('本地模板创建后无法读取');
				imported += 1;
			}
			const publication = await database.prepare(`SELECT template_id FROM global_cloud_email_template_publications
				WHERE template_id = ?1 AND channel_id = ?2`).bind(local.template_id, channelId).first();
			if (publication) await database.prepare(`UPDATE global_cloud_email_template_publications SET provider_template_id = ?3,
				status = ?4, updated_at = ?5 WHERE template_id = ?1 AND channel_id = ?2`)
				.bind(local.template_id, channelId, remote.providerTemplateId, remote.status, now).run();
			else await database.prepare(`INSERT INTO global_cloud_email_template_publications
				(template_id, channel_id, provider_template_id, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)`)
				.bind(local.template_id, channelId, remote.providerTemplateId, remote.status, now).run();
		} catch (error) { failures.push(`${summary.name}：${error instanceof Error ? error.message : '同步失败'}`); }
	}
	return { imported, updated, total: remoteTemplates.length, failures };
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
		const [rows, channels] = await Promise.all([
			database.prepare(`SELECT t.id, t.template_key, t.template_type, t.name, t.subject, t.body_text, t.body_html, t.status,
				t.created_at, t.updated_at, COALESCE(GROUP_CONCAT(p.status), '未发布') AS publication_status
				FROM global_cloud_email_templates t LEFT JOIN global_cloud_email_template_publications p ON p.template_id = t.id
				GROUP BY t.id, t.template_key, t.template_type, t.name, t.subject, t.body_text, t.body_html, t.status, t.created_at, t.updated_at ORDER BY t.id DESC`).all<Record<string, unknown>>(),
			database.prepare(`SELECT ch.id, ch.account_name, ch.region, c.name AS credential_name, c.provider FROM global_cloud_email_channels ch
				JOIN global_cloud_credentials c ON c.id = ch.cloud_credential_id
				WHERE ch.status = 'enabled' AND c.status = 'enabled' AND c.provider = 'aliyun' ORDER BY c.name, ch.region, ch.account_name`)
				.all<{ id: number; account_name: string; region: string; credential_name: string; provider: string }>(),
		]);
		const syncColumns = [
			{ dataIndex: 'channel_id', title: '阿里云邮件通道', component: 'select', options: channels.results.map((item) => ({ value: String(item.id), text: `${item.credential_name} / ${item.account_name} / ${getCloudEmailRegionLabel(item.provider, item.region)}（${item.region}）` })), rules: [{ required: true, message: '请选择阿里云邮件通道' }] },
			{ dataIndex: 'template_type', title: '导入为模板类型', component: 'select', options: cloudEmailPurposeOptions, rules: [{ required: true, message: '请选择模板类型' }] },
		];
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'create', label: '新增' }, { key: 'sync', label: '同步阿里云模板', form: { columns: syncColumns } }, { key: 'delete', label: '删除' }], row: [{ key: 'restore', label: '还原默认', confirm: '确认用后端默认模板覆盖当前名称、主题和正文吗？' }, { key: 'publish', label: '发布/更新' }, { key: 'refresh', label: '刷新状态' }, { key: 'edit', label: '编辑' }, { key: 'delete', label: '删除' }] } }, columns, dataSource: rows.results, totalRecords: rows.results.length } });
	}
	if (!params.id && c.req.method === 'POST' && c.req.query('action') === 'sync') {
		const body = await parseBody(c), channelId = Number(body.channel_id), templateType = text(body.template_type);
		if (!Number.isInteger(channelId) || !cloudEmailPurposeKeys.has(templateType)) return apiMessage(c, 400, '阿里云邮件通道或模板类型不合法');
		try {
			const result = await syncAliyunTemplates(database, channelId, templateType);
			const message = `云端模板同步完成：发现 ${result.total} 个，新增 ${result.imported} 个，更新 ${result.updated} 个${result.failures.length ? `，失败 ${result.failures.length} 个：${result.failures.join('；')}` : ''}`;
			return apiMessageData(c, 200, message, result, { component: 'modal', type: result.failures.length ? 'warning' : 'success', title: '阿里云模板同步' });
		} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : '阿里云模板同步失败'); }
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
		const failures = template.status === statusValues.enabled ? await publishToEnabledChannels(database, template) : [];
		return apiMessageData(c, 201, failures.length ? `模板已创建，但有 ${failures.length} 个通道发布失败：${failures.join('；')}` : '邮件模板创建并提交云端审核成功', { id: template.id });
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
		const failures = await publishToEnabledChannels(database, template);
		return failures.length ? apiMessage(c, 502, failures.join('；')) : apiMessage(c, 200, '模板已提交全部启用通道审核');
	}
	if (params.id && c.req.method === 'POST' && c.req.query('action') === 'refresh') {
		const publications = await database.prepare(`SELECT channel_id, provider_template_id FROM global_cloud_email_template_publications WHERE template_id = ?1`)
			.bind(Number(params.id)).all<{ channel_id: number; provider_template_id: string }>();
		if (!publications.results.length) return apiMessage(c, 404, '模板尚未发布到云端');
		const failures: string[] = [];
		for (const row of publications.results) {
			try {
				const target = await loadCloudEmailTarget(database, row.channel_id);
				if (!target) throw new Error(`邮件通道 ${row.channel_id} 不存在或已停用`);
				const publication = await refreshCloudEmailTemplate(target, row.provider_template_id);
				await database.prepare(`UPDATE global_cloud_email_template_publications SET status = ?3, updated_at = ?4 WHERE template_id = ?1 AND channel_id = ?2`)
					.bind(Number(params.id), row.channel_id, publication.status, Date.now()).run();
			} catch (error) { failures.push(error instanceof Error ? error.message : `邮件通道 ${row.channel_id} 状态刷新失败`); }
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
		const failures = current.status === statusValues.enabled ? await publishToEnabledChannels(database, restored) : [];
		return failures.length
			? apiMessage(c, 502, `本地模板已还原，但云端更新失败：${failures.join('；')}`)
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
		const failures = status === statusValues.enabled && (contentChanged || current.status !== status) ? await publishToEnabledChannels(database, updated) : [];
		return failures.length ? apiMessage(c, 502, `本地模板已保存，但云端更新失败：${failures.join('；')}`) : apiMessage(c, 200, '保存成功');
	}
	if (params.id && c.req.method === 'DELETE') {
		const error = await deleteTemplate(database, Number(params.id));
		return error ? apiMessage(c, 409, error) : apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
