import type { DatabaseAdapter } from '@server/database/index.mjs';
import { getCloudEmailAdapter } from './catalog.mjs';
import type { CloudEmailAdapter, CloudEmailMessage, CloudEmailScope, CloudEmailTarget, CloudEmailTemplate, CloudEmailTemplatePublication } from './index.mjs';
import { createAliyunDirectMailAdapter, createAliyunDirectMailTemplate, describeAliyunDirectMailTemplate, updateAliyunDirectMailTemplate } from './providers/aliyun-direct-mail.mjs';
import { createTencentSesAdapter, createTencentSesTemplate, describeTencentSesTemplate, updateTencentSesTemplate } from './providers/tencent-ses.mjs';

type DefaultEmailConfiguration = CloudEmailTarget & CloudEmailTemplate & {
	provider_template_id: string;
	publication_status: string;
};

const targetSelect = `SELECT ch.id, c.provider, ch.cloud_credential_id, ch.region, ch.account_name,
	ch.from_alias, ch.reply_to_address, c.access_key_id, c.access_key_secret
	FROM global_cloud_email_bindings b
	JOIN global_cloud_email_channels ch ON ch.id = b.channel_id
	JOIN global_cloud_credentials c ON c.id = ch.cloud_credential_id`;

export const loadDefaultCloudEmailTarget = async (database: DatabaseAdapter, siteKey: string, purpose: string) => database.prepare(`${targetSelect}
	WHERE b.site_key = ?1 AND b.purpose = ?2 AND b.is_default = 1
		AND b.status = 'enabled' AND ch.status = 'enabled' AND c.status = 'enabled'`)
	.bind(siteKey, purpose).first<CloudEmailTarget>();

export const loadCloudEmailTarget = async (database: DatabaseAdapter, channelId: number) => database.prepare(`SELECT ch.id,
	c.provider, ch.cloud_credential_id, ch.region, ch.account_name, ch.from_alias, ch.reply_to_address,
	c.access_key_id, c.access_key_secret FROM global_cloud_email_channels ch
	JOIN global_cloud_credentials c ON c.id = ch.cloud_credential_id
	WHERE ch.id = ?1 AND ch.status = 'enabled' AND c.status = 'enabled'`).bind(channelId).first<CloudEmailTarget>();

export const loadCloudEmailScope = async (database: DatabaseAdapter, credentialId: number, region: string) => database.prepare(`SELECT c.provider,
	c.id AS cloud_credential_id, ?2 AS region, c.access_key_id, c.access_key_secret FROM global_cloud_credentials c
	WHERE c.id = ?1 AND c.status = 'enabled'`).bind(credentialId, region).first<CloudEmailScope>();

export const createCloudEmailAdapter = (target: CloudEmailTarget): CloudEmailAdapter => {
	const adapter = getCloudEmailAdapter(target.provider);
	if (adapter === 'aliyun-direct-mail') return createAliyunDirectMailAdapter(target);
	if (adapter === 'tencent-ses') return createTencentSesAdapter(target);
	throw new Error(`该 Provider 不支持邮件推送：${target.provider}`);
};

export const publishCloudEmailTemplate = async (target: CloudEmailScope, template: CloudEmailTemplate, providerTemplateId?: string): Promise<CloudEmailTemplatePublication> => {
	const adapter = getCloudEmailAdapter(target.provider);
	if (adapter === 'aliyun-direct-mail') return providerTemplateId
		? updateAliyunDirectMailTemplate(target, template, providerTemplateId)
		: createAliyunDirectMailTemplate(target, template);
	if (adapter === 'tencent-ses') return providerTemplateId
		? updateTencentSesTemplate(target, template, providerTemplateId)
		: createTencentSesTemplate(target, template);
	throw new Error(`该 Provider 不支持云端邮件模板：${target.provider}`);
};

export const refreshCloudEmailTemplate = async (target: CloudEmailScope, providerTemplateId: string): Promise<CloudEmailTemplatePublication> => {
	const adapter = getCloudEmailAdapter(target.provider);
	if (adapter === 'aliyun-direct-mail') return describeAliyunDirectMailTemplate(target, providerTemplateId);
	if (adapter === 'tencent-ses') return describeTencentSesTemplate(target, providerTemplateId);
	throw new Error(`该 Provider 不支持云端邮件模板：${target.provider}`);
};

const variablePattern = /\{\{([a-z][a-z0-9_]*)\}\}/g;
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const render = (source: string, variables: Record<string, string>, html: boolean) => source.replace(variablePattern, (_, key: string) => {
	if (!(key in variables)) throw new Error(`邮件模板缺少变量：${key}`);
	return html ? escapeHtml(variables[key]) : variables[key];
});

export const renderCloudEmailTemplate = (template: Pick<CloudEmailTemplate, 'subject' | 'body_text' | 'body_html'>, variables: Record<string, string>): Omit<CloudEmailMessage, 'to'> => ({
	subject: render(template.subject, variables, false),
	text: render(template.body_text, variables, false),
	html: render(template.body_html, variables, true),
});

export const sendDefaultCloudEmail = async (database: DatabaseAdapter, siteKey: string, purpose: string, to: string, variables: Record<string, string>) => {
	const configuration = await database.prepare(`SELECT ch.id, c.provider, ch.cloud_credential_id, ch.region, ch.account_name,
		ch.from_alias, ch.reply_to_address, c.access_key_id, c.access_key_secret,
		t.id AS template_id, t.template_key, t.template_type, t.name, t.subject, t.body_text, t.body_html, t.status,
		p.provider_template_id, p.status AS publication_status
		FROM global_cloud_email_bindings b
		JOIN global_cloud_email_channels ch ON ch.id = b.channel_id
		JOIN global_cloud_credentials c ON c.id = ch.cloud_credential_id
		JOIN global_cloud_email_templates t ON t.id = b.template_id
		JOIN global_cloud_email_template_publications p ON p.template_id = t.id
			AND p.cloud_credential_id = ch.cloud_credential_id AND p.region = ch.region
		WHERE b.site_key = ?1 AND b.purpose = ?2 AND b.is_default = 1 AND b.status = 'enabled'
			AND ch.status = 'enabled' AND c.status = 'enabled' AND t.status = 'enabled' AND p.status = 'ready'`)
		.bind(siteKey, purpose).first<DefaultEmailConfiguration>();
	if (!configuration) throw new Error(`站点 ${siteKey} 没有可用的 ${purpose} 默认邮件模板`);
	const rendered = renderCloudEmailTemplate(configuration, variables);
	return createCloudEmailAdapter(configuration).send({ to, ...rendered, template: {
		providerTemplateId: configuration.provider_template_id,
		variables,
	} });
};
