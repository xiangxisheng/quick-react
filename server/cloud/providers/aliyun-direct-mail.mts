import type { CloudEmailAdapter, CloudEmailTarget, CloudEmailTemplate, CloudEmailTemplatePublication } from '../index.mjs';

const encoder = new TextEncoder();

const percentEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const toBase64 = (buffer: ArrayBuffer) => {
	let binary = '';
	for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
	return btoa(binary);
};
const hmacSha1Base64 = async (key: string, value: string) => toBase64(await crypto.subtle.sign(
	'HMAC',
	await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']),
	encoder.encode(value),
));

const endpoint = (region: string) => region === 'ap-southeast-1'
	? 'https://dm.ap-southeast-1.aliyuncs.com/'
	: 'https://dm.aliyuncs.com/';

type AliyunMailAddress = {
	AccountName?: string;
	AccountStatus?: number;
	DomainStatus?: number;
	ReplyAddress?: string;
	ReplyStatus?: number;
	Sendtype?: string;
};

type AliyunTemplateSummary = {
	TemplateId?: number | string;
	TemplateName?: string;
	TemplateStatus?: number | string;
};

export type AliyunDirectMailRemoteTemplate = {
	providerTemplateId: string;
	name: string;
	subject: string;
	html: string;
	status: CloudEmailTemplatePublication['status'];
};

type AliyunResult = {
	RequestId?: string;
	Code?: string;
	Message?: string;
	EnvId?: string;
	TemplateId?: number | string;
	TemplateStatus?: number | string;
	TemplateName?: string;
	TemplateSubject?: string;
	TemplateText?: string;
	TotalCount?: number;
	data?: { mailAddress?: AliyunMailAddress[]; template?: AliyunTemplateSummary[] };
};

const callDirectMail = async (target: Pick<CloudEmailTarget, 'region' | 'access_key_id' | 'access_key_secret'>, action: string, actionParameters: Record<string, string>) => {
	if (!target.access_key_id || !target.access_key_secret) throw new Error('阿里云邮件推送凭据不完整');
	const parameters: Record<string, string> = {
		AccessKeyId: target.access_key_id,
		Action: action,
		Format: 'JSON',
		RegionId: target.region,
		SignatureMethod: 'HMAC-SHA1',
		SignatureNonce: crypto.randomUUID(),
		SignatureVersion: '1.0',
		Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
		Version: '2015-11-23',
		...actionParameters,
	};
	const canonicalQuery = Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${percentEncode(key)}=${percentEncode(value)}`).join('&');
	const signature = await hmacSha1Base64(`${target.access_key_secret}&`, `POST&%2F&${percentEncode(canonicalQuery)}`);
	const response = await fetch(endpoint(target.region), {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
		body: `Signature=${percentEncode(signature)}&${canonicalQuery}`,
	});
	const result = await response.json().catch(() => ({})) as AliyunResult;
	if (!response.ok || result.Code) throw new Error(`阿里云邮件推送失败：${result.Message ?? `HTTP ${response.status}`}${result.Code ? `（${result.Code}）` : ''}`);
	if (!result.RequestId) throw new Error('阿里云邮件推送失败：响应缺少 RequestId');
	return result;
};

const providerTemplateText = (value: string) => value.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, '{$1}');
const providerTemplateName = (template: CloudEmailTemplate, channelId: number) => `${template.template_key}_${template.id}_${channelId}`.slice(0, 30);
const publicationStatus = (value: number | string | undefined): CloudEmailTemplatePublication['status'] => Number(value) === 2 ? 'ready' : Number(value) === 3 ? 'rejected' : 'reviewing';

export const listAliyunDirectMailAddresses = async (target: Pick<CloudEmailTarget, 'region' | 'access_key_id' | 'access_key_secret'>) => {
	const pageSize = 100;
	const addresses: Array<{ accountName: string; replyAddress: string; replyEnabled: boolean }> = [];
	for (let page = 1; ; page += 1) {
		const result = await callDirectMail(target, 'QueryMailAddressByParam', {
			KeyWord: '@',
			PageNo: String(page),
			PageSize: String(pageSize),
			Sendtype: 'trigger',
		});
		const rows = result.data?.mailAddress ?? [];
		addresses.push(...rows.filter((item) => item.AccountName && item.AccountStatus === 0 && item.DomainStatus === 0)
			.map((item) => ({ accountName: item.AccountName!, replyAddress: item.ReplyAddress ?? '', replyEnabled: item.ReplyStatus === 0 })));
		if (!rows.length || page * pageSize >= (result.TotalCount ?? rows.length)) break;
	}
	return addresses;
};

export const listAliyunDirectMailTemplates = async (target: Pick<CloudEmailTarget, 'region' | 'access_key_id' | 'access_key_secret'>) => {
	const pageSize = 20;
	const templates: AliyunTemplateSummary[] = [];
	for (let page = 1; ; page += 1) {
		const result = await callDirectMail(target, 'QueryTemplateByParam', { PageNo: String(page), PageSize: String(pageSize) });
		const rows = result.data?.template ?? [];
		templates.push(...rows);
		if (!rows.length || page * pageSize >= (result.TotalCount ?? rows.length)) break;
	}
	return templates.filter((item) => item.TemplateId !== undefined && String(item.TemplateId).trim())
		.map((item) => ({ providerTemplateId: String(item.TemplateId), name: item.TemplateName?.trim() || `阿里云模板 ${item.TemplateId}`, status: publicationStatus(item.TemplateStatus) }));
};

export const getAliyunDirectMailTemplate = async (target: Pick<CloudEmailTarget, 'region' | 'access_key_id' | 'access_key_secret'>, providerTemplateId: string): Promise<AliyunDirectMailRemoteTemplate> => {
	const result = await callDirectMail(target, 'DescTemplate', { TemplateId: providerTemplateId });
	return {
		providerTemplateId,
		name: result.TemplateName?.trim() || `阿里云模板 ${providerTemplateId}`,
		subject: result.TemplateSubject?.trim() || '无主题',
		html: result.TemplateText?.trim() || '<p>空模板</p>',
		status: publicationStatus(result.TemplateStatus),
	};
};

export const createAliyunDirectMailTemplate = async (target: CloudEmailTarget, template: CloudEmailTemplate): Promise<CloudEmailTemplatePublication> => {
	const result = await callDirectMail(target, 'CreateTemplate', {
		TemplateName: providerTemplateName(template, target.id),
		TemplateNickName: template.name.slice(0, 30),
		TemplateSubject: providerTemplateText(template.subject),
		TemplateText: providerTemplateText(template.body_html),
		TemplateType: '0',
	});
	if (result.TemplateId === undefined || String(result.TemplateId).trim() === '') throw new Error('阿里云邮件模板创建失败：响应缺少 TemplateId');
	return { providerTemplateId: String(result.TemplateId), status: 'reviewing', requestId: result.RequestId! };
};

export const updateAliyunDirectMailTemplate = async (target: CloudEmailTarget, template: CloudEmailTemplate, providerTemplateId: string): Promise<CloudEmailTemplatePublication> => {
	const result = await callDirectMail(target, 'ModifyTemplate', {
		TemplateId: providerTemplateId,
		TemplateName: providerTemplateName(template, target.id),
		TemplateNickName: template.name.slice(0, 30),
		TemplateSubject: providerTemplateText(template.subject),
		TemplateText: providerTemplateText(template.body_html),
	});
	return { providerTemplateId, status: 'reviewing', requestId: result.RequestId! };
};

export const describeAliyunDirectMailTemplate = async (target: CloudEmailTarget, providerTemplateId: string): Promise<CloudEmailTemplatePublication> => {
	const result = await callDirectMail(target, 'DescTemplate', { TemplateId: providerTemplateId });
	const status = publicationStatus(result.TemplateStatus);
	return { providerTemplateId, status, requestId: result.RequestId! };
};

export const createAliyunDirectMailAdapter = (target: CloudEmailTarget): CloudEmailAdapter => ({
	send: async (message) => {
		if (!message.to || !message.subject || (!message.text && !message.html)) throw new Error('邮件收件人、主题和正文不能为空');
		const parameters: Record<string, string> = {
			AccountName: target.account_name,
			AddressType: '1',
			FromAlias: target.from_alias,
			RegionId: target.region,
			ReplyToAddress: target.reply_to_address ? 'true' : 'false',
			Subject: message.subject,
			ToAddress: message.to,
		};
		if (message.template) parameters.Template = JSON.stringify({
			TemplateId: message.template.providerTemplateId,
			TemplateData: message.template.variables,
		});
		else {
			parameters.HtmlBody = message.html;
			parameters.TextBody = message.text;
		}
		const result = await callDirectMail(target, 'SingleSendMail', parameters);
		return { requestId: result.RequestId!, messageId: result.EnvId ?? result.RequestId! };
	},
});
