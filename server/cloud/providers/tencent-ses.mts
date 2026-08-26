import type { CloudEmailAdapter, CloudEmailScope, CloudEmailTarget, CloudEmailTemplate, CloudEmailTemplatePublication } from '../index.mjs';
import { callTencentCloudApi } from './tencent-api.mjs';

type TencentSesResponse = { RequestId?: string; Error?: { Code?: string; Message?: string } };
type TencentTemplateContent = { Html?: string; Text?: string };

export type TencentSesRemoteTemplate = {
	providerTemplateId: string;
	name: string;
	text: string;
	html: string;
	status: CloudEmailTemplatePublication['status'];
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const toBase64 = (value: string) => {
	let binary = '';
	for (const byte of encoder.encode(value)) binary += String.fromCharCode(byte);
	return btoa(binary);
};
const fromBase64 = (value: string | undefined) => {
	if (!value) return '';
	try {
		const binary = atob(value);
		return decoder.decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
	} catch { throw new Error('腾讯云邮件模板内容不是有效的 Base64'); }
};
const callSes = <T extends TencentSesResponse>(target: CloudEmailScope, action: string, payload?: Record<string, unknown>) => callTencentCloudApi<T>(target, {
	service: 'ses', host: 'ses.tencentcloudapi.com', version: '2020-10-02', action, region: target.region, payload, errorLabel: '腾讯云邮件推送',
});
const publicationStatus = (value: number | undefined): CloudEmailTemplatePublication['status'] => value === 0 ? 'ready' : value === 2 ? 'rejected' : 'reviewing';
const templateId = (value: string) => {
	const id = Number(value);
	if (!Number.isInteger(id) || id <= 0) throw new Error('腾讯云邮件模板 ID 不合法');
	return id;
};
const providerTemplateName = (template: CloudEmailTemplate) => `${template.template_key}_${template.id}`.slice(0, 60);
const templateContent = (template: CloudEmailTemplate): TencentTemplateContent => ({ Html: toBase64(template.body_html), Text: toBase64(template.body_text) });

export const listTencentSesAddresses = async (target: CloudEmailScope) => {
	const result = await callSes<{ EmailSenders?: Array<{ EmailAddress?: string; EmailSenderName?: string }>; RequestId?: string }>(target, 'ListEmailAddress');
	return (result.EmailSenders ?? []).filter((item) => item.EmailAddress?.trim()).map((item) => ({
		accountName: item.EmailAddress!.trim(),
		senderName: item.EmailSenderName?.trim() ?? '',
	}));
};

export const listTencentSesTemplates = async (target: CloudEmailScope) => {
	const limit = 100;
	const templates: Array<{ providerTemplateId: string; name: string; status: CloudEmailTemplatePublication['status'] }> = [];
	for (let offset = 0; ; offset += limit) {
		const result = await callSes<{ TemplatesMetadata?: Array<{ TemplateID?: number; TemplateName?: string; TemplateStatus?: number }>; TotalCount?: number; RequestId?: string }>(target,
			'ListEmailTemplates', { Limit: limit, Offset: offset });
		const rows = result.TemplatesMetadata ?? [];
		templates.push(...rows.filter((item) => Number.isInteger(item.TemplateID) && item.TemplateID! > 0).map((item) => ({
			providerTemplateId: String(item.TemplateID),
			name: item.TemplateName?.trim() || `腾讯云模板 ${item.TemplateID}`,
			status: publicationStatus(item.TemplateStatus),
		})));
		if (!rows.length || offset + rows.length >= (result.TotalCount ?? rows.length)) break;
	}
	return templates;
};

export const getTencentSesTemplate = async (target: CloudEmailScope, providerTemplateId: string): Promise<TencentSesRemoteTemplate> => {
	const result = await callSes<{ TemplateContent: TencentTemplateContent; TemplateStatus: number; TemplateName: string; RequestId?: string }>(target,
		'GetEmailTemplate', { TemplateID: templateId(providerTemplateId) });
	return {
		providerTemplateId,
		name: result.TemplateName?.trim() || `腾讯云模板 ${providerTemplateId}`,
		text: fromBase64(result.TemplateContent?.Text),
		html: fromBase64(result.TemplateContent?.Html),
		status: publicationStatus(result.TemplateStatus),
	};
};

export const createTencentSesTemplate = async (target: CloudEmailScope, template: CloudEmailTemplate): Promise<CloudEmailTemplatePublication> => {
	const result = await callSes<{ TemplateID?: number; RequestId?: string }>(target, 'CreateEmailTemplate', {
		TemplateName: providerTemplateName(template), TemplateContent: templateContent(template),
	});
	if (!Number.isInteger(result.TemplateID) || result.TemplateID! <= 0) throw new Error('腾讯云邮件模板创建失败：响应缺少 TemplateID');
	return { providerTemplateId: String(result.TemplateID), status: 'reviewing', requestId: result.RequestId! };
};

export const updateTencentSesTemplate = async (target: CloudEmailScope, template: CloudEmailTemplate, providerTemplateId: string): Promise<CloudEmailTemplatePublication> => {
	const result = await callSes<{ RequestId?: string }>(target, 'UpdateEmailTemplate', {
		TemplateID: templateId(providerTemplateId), TemplateName: providerTemplateName(template), TemplateContent: templateContent(template),
	});
	return { providerTemplateId, status: 'reviewing', requestId: result.RequestId! };
};

export const describeTencentSesTemplate = async (target: CloudEmailScope, providerTemplateId: string): Promise<CloudEmailTemplatePublication> => {
	const result = await callSes<{ TemplateStatus: number; RequestId?: string }>(target, 'GetEmailTemplate', { TemplateID: templateId(providerTemplateId) });
	return { providerTemplateId, status: publicationStatus(result.TemplateStatus), requestId: result.RequestId! };
};

export const createTencentSesAdapter = (target: CloudEmailTarget): CloudEmailAdapter => ({
	send: async (message) => {
		if (!message.to || !message.subject || !message.template) throw new Error('腾讯云 SES 发送需要收件人、主题和已审核模板');
		if (target.from_alias.includes(':')) throw new Error('腾讯云 SES 发信人名称不能包含冒号');
		const result = await callSes<{ MessageId?: string; RequestId?: string }>(target, 'SendEmail', {
			FromEmailAddress: `${target.from_alias} <${target.account_name}>`,
			Subject: message.subject,
			Destination: [message.to],
			...(target.reply_to_address ? { ReplyToAddresses: target.account_name } : {}),
			Template: {
				TemplateID: templateId(message.template.providerTemplateId),
				TemplateData: JSON.stringify(message.template.variables),
			},
			TriggerType: 1,
		});
		if (!result.MessageId) throw new Error('腾讯云邮件发送失败：响应缺少 MessageId');
		return { requestId: result.RequestId!, messageId: result.MessageId };
	},
});
