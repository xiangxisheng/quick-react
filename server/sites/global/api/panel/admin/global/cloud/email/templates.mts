import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { loadCloudEmailTarget, publishCloudEmailTemplate, refreshCloudEmailTemplate } from '@server/cloud/email.mjs';
import type { CloudEmailTemplate } from '@server/cloud/index.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';

const columns = [
	{ dataIndex: 'template_key', title: '模板 Key', component: 'textbox', placeholder: 'email_verification', rules: [{ required: true, message: '请输入模板 Key' }] },
	{ dataIndex: 'name', title: '名称', component: 'textbox', rules: [{ required: true, message: '请输入名称' }] },
	{ dataIndex: 'subject', title: '主题', component: 'textbox', rules: [{ required: true, message: '请输入主题' }] },
	{ dataIndex: 'body_text', title: '纯文本正文', component: 'textarea', rules: [{ required: true, message: '请输入纯文本正文' }] },
	{ dataIndex: 'body_html', title: 'HTML 正文', component: 'textarea', rules: [{ required: true, message: '请输入 HTML 正文' }] },
	{ dataIndex: 'publication_status', title: '云端发布' },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
];

const keyPattern = /^[a-z][a-z0-9_]*$/;
const parseBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({}));
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const loadTemplate = (database: DatabaseAdapter, id: number) => database.prepare(`SELECT id, template_key, name, subject, body_text, body_html, status
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
		const rows = await database.prepare(`SELECT t.id, t.template_key, t.name, t.subject, t.body_text, t.body_html, t.status,
			t.created_at, t.updated_at, COALESCE(GROUP_CONCAT(p.status), '未发布') AS publication_status
			FROM global_cloud_email_templates t LEFT JOIN global_cloud_email_template_publications p ON p.template_id = t.id
			GROUP BY t.id, t.template_key, t.name, t.subject, t.body_text, t.body_html, t.status, t.created_at, t.updated_at ORDER BY t.id DESC`).all<Record<string, unknown>>();
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'create', label: '新增' }, { key: 'delete', label: '删除' }], row: [{ key: 'publish', label: '发布/更新' }, { key: 'refresh', label: '刷新状态' }, { key: 'edit', label: '编辑' }, { key: 'delete', label: '删除' }] } }, columns, dataSource: rows.results, totalRecords: rows.results.length } });
	}
	if (!params.id && c.req.method === 'POST') {
		const body = await parseBody(c), templateKey = text(body.template_key), name = text(body.name), subject = text(body.subject), bodyText = text(body.body_text), bodyHtml = text(body.body_html);
		if (!keyPattern.test(templateKey) || !name || !subject || !bodyText || !bodyHtml) return apiMessage(c, 400, '模板 Key、名称、主题和正文不合法');
		try {
			await database.prepare(`INSERT INTO global_cloud_email_templates
				(template_key, name, subject, body_text, body_html, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`)
				.bind(templateKey, name, subject, bodyText, bodyHtml, body.status === statusValues.disabled ? statusValues.disabled : statusValues.enabled, Date.now()).run();
		} catch { return apiMessage(c, 409, '模板 Key 已经存在'); }
		const template = await database.prepare(`SELECT id, template_key, name, subject, body_text, body_html, status FROM global_cloud_email_templates WHERE template_key = ?1`).bind(templateKey).first<CloudEmailTemplate>();
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
		const row = await database.prepare(`SELECT id, template_key, name, subject, body_text, body_html, status, created_at, updated_at
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
	if (params.id && c.req.method === 'PUT') {
		const current = await loadTemplate(database, Number(params.id));
		if (!current) return apiMessage(c, 404, '邮件模板不存在');
		const body = await parseBody(c), changed = getChangedFields(body, ['template_key', 'name', 'subject', 'body_text', 'body_html', 'status']);
		const templateKey = changed.has('template_key') ? text(body.template_key) : current.template_key;
		const name = changed.has('name') ? text(body.name) : current.name, subject = changed.has('subject') ? text(body.subject) : current.subject;
		const bodyText = changed.has('body_text') ? text(body.body_text) : current.body_text, bodyHtml = changed.has('body_html') ? text(body.body_html) : current.body_html;
		const status = changed.has('status') && body.status === statusValues.disabled ? statusValues.disabled : changed.has('status') ? statusValues.enabled : current.status;
		if (!keyPattern.test(templateKey) || !name || !subject || !bodyText || !bodyHtml) return apiMessage(c, 400, '模板 Key、名称、主题和正文不合法');
		try {
			await database.prepare(`UPDATE global_cloud_email_templates SET template_key = ?2, name = ?3, subject = ?4, body_text = ?5,
				body_html = ?6, status = ?7, updated_at = ?8 WHERE id = ?1`).bind(current.id, templateKey, name, subject, bodyText, bodyHtml, status, Date.now()).run();
		} catch { return apiMessage(c, 409, '模板 Key 已经存在'); }
		const updated = { ...current, template_key: templateKey, name, subject, body_text: bodyText, body_html: bodyHtml, status };
		const contentChanged = ['template_key', 'name', 'subject', 'body_text', 'body_html'].some((field) => changed.has(field));
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
