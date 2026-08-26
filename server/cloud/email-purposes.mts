export const cloudEmailPurposeOptions = [
	{ value: 'email_verification', text: '邮箱验证码' },
] as const;

export const cloudEmailPurposeKeys = new Set<string>(cloudEmailPurposeOptions.map((item) => item.value));

type EmailTemplateContent = {
	subject: string;
	body_text: string;
	body_html: string;
};

const variablePattern = /\{\{([^{}]+)\}\}/g;
const variableNamePattern = /^[a-z][a-z0-9_]*$/;
const emailVerificationVariables = new Set(['code', 'email', 'expires_minutes']);

const variablesIn = (value: string) => [...value.matchAll(variablePattern)].map((match) => match[1]);

export const validateCloudEmailTemplateVariables = (templateType: string, template: EmailTemplateContent) => {
	const sources = [template.subject, template.body_text, template.body_html];
	const variables = sources.flatMap(variablesIn);
	const malformed = variables.find((variable) => !variableNamePattern.test(variable));
	if (malformed) return `模板变量名不合法：${malformed}`;
	if (sources.some((source) => source.replace(variablePattern, '').includes('{{') || source.replace(variablePattern, '').includes('}}'))) return '模板变量格式不合法，请使用 {{variable_name}}';
	if (templateType !== 'email_verification') return;
	const unsupported = variables.find((variable) => !emailVerificationVariables.has(variable));
	if (unsupported) return `邮箱验证码模板不支持变量：${unsupported}`;
	if (!variablesIn(template.body_text).includes('code')) return '邮箱验证码模板的纯文本正文必须包含 {{code}}';
	if (!variablesIn(template.body_html).includes('code')) return '邮箱验证码模板的 HTML 正文必须包含 {{code}}';
};
