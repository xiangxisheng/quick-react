import type { DatabaseAdapter } from '@server/database/index.mjs';
import { getCloudEmailAdapter } from './catalog.mjs';
import type { CloudEmailAdapter, CloudEmailMessage, CloudEmailScope, CloudEmailTarget, CloudEmailTemplate, CloudEmailTemplatePublication } from './index.mjs';
import { createAliyunDirectMailAdapter, createAliyunDirectMailTemplate, describeAliyunDirectMailTemplate, updateAliyunDirectMailTemplate } from './providers/aliyun-direct-mail.mjs';
import { createTencentSesAdapter, createTencentSesTemplate, describeTencentSesTemplate, updateTencentSesTemplate } from './providers/tencent-ses.mjs';
import { firstSql, sql } from '@server/database/sql.mjs';

type DefaultEmailConfiguration = CloudEmailTarget & CloudEmailTemplate & {
	template_id: number;
	provider_template_id: string;
	publication_status: string;
};

const targetColumns = { id: 'ch.id', provider: 'c.provider', cloud_credential_id: 'ch.cloud_credential_id', region: 'ch.region', account_name: 'ch.account_name', from_alias: 'ch.from_alias', reply_to_address: 'ch.reply_to_address', access_key_id: 'c.access_key_id', access_key_secret: 'c.access_key_secret' };
const targetJoins = [
	{ table: 'global_cloud_email_channels', alias: 'ch', left: 'ch.id', right: 'b.channel_id' },
	{ table: 'global_cloud_credentials', alias: 'c', left: 'c.id', right: 'ch.cloud_credential_id' },
] as const;

export const loadDefaultCloudEmailTarget = async (database: DatabaseAdapter, siteKey: string, purpose: string) => firstSql<CloudEmailTarget>(database, sql(database).select({ table: 'global_cloud_email_bindings', alias: 'b', columns: targetColumns, joins: [...targetJoins], where: [{ column: 'b.site_key', value: siteKey }, { column: 'b.purpose', value: purpose }, { column: 'b.is_default', value: 1 }, { column: 'b.status', value: 'enabled' }, { column: 'ch.status', value: 'enabled' }, { column: 'c.status', value: 'enabled' }], limit: 1 }));

export const loadCloudEmailTarget = async (database: DatabaseAdapter, channelId: number) => firstSql<CloudEmailTarget>(database, sql(database).select({ table: 'global_cloud_email_channels', alias: 'ch', columns: targetColumns, joins: [{ table: 'global_cloud_credentials', alias: 'c', left: 'c.id', right: 'ch.cloud_credential_id' }], where: [{ column: 'ch.id', value: channelId }, { column: 'ch.status', value: 'enabled' }, { column: 'c.status', value: 'enabled' }] }));

export const loadCloudEmailScope = async (database: DatabaseAdapter, credentialId: number, region: string) => {
	const credential = await firstSql<Omit<CloudEmailScope, 'region'>>(database, sql(database).select({ table: 'global_cloud_credentials', columns: { provider: 'provider', cloud_credential_id: 'id', access_key_id: 'access_key_id', access_key_secret: 'access_key_secret' }, where: [{ column: 'id', value: credentialId }, { column: 'status', value: 'enabled' }] }));
	return credential ? { ...credential, region } : null;
};

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
	const configuration = await firstSql<Omit<DefaultEmailConfiguration, 'provider_template_id' | 'publication_status'>>(database, sql(database).select({ table: 'global_cloud_email_bindings', alias: 'b', columns: { ...targetColumns, template_id: 't.id', template_key: 't.template_key', template_type: 't.template_type', name: 't.name', subject: 't.subject', body_text: 't.body_text', body_html: 't.body_html', status: 't.status' }, joins: [...targetJoins, { table: 'global_cloud_email_templates', alias: 't', left: 't.id', right: 'b.template_id' }], where: [{ column: 'b.site_key', value: siteKey }, { column: 'b.purpose', value: purpose }, { column: 'b.is_default', value: 1 }, { column: 'b.status', value: 'enabled' }, { column: 'ch.status', value: 'enabled' }, { column: 'c.status', value: 'enabled' }, { column: 't.status', value: 'enabled' }], limit: 1 }));
	if (!configuration) throw new Error(`站点 ${siteKey} 没有可用的 ${purpose} 默认邮件模板`);
	const publication = await firstSql<{ provider_template_id: string; publication_status: string }>(database, sql(database).select({ table: 'global_cloud_email_template_publications', columns: { provider_template_id: 'provider_template_id', publication_status: 'status' }, where: [{ column: 'template_id', value: configuration.template_id }, { column: 'cloud_credential_id', value: configuration.cloud_credential_id }, { column: 'region', value: configuration.region }, { column: 'status', value: 'ready' }] }));
	if (!publication) throw new Error(`站点 ${siteKey} 没有可用的 ${purpose} 默认邮件模板`);
	const readyConfiguration: DefaultEmailConfiguration = { ...configuration, ...publication };
	const rendered = renderCloudEmailTemplate(readyConfiguration, variables);
	return createCloudEmailAdapter(readyConfiguration).send({ to, ...rendered, template: {
		providerTemplateId: readyConfiguration.provider_template_id,
		variables,
	} });
};
