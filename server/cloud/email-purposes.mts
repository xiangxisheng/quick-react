export const cloudEmailPurposeOptions = [
	{ value: 'email_verification', text: '邮箱验证码' },
] as const;

export const cloudEmailPurposeKeys = new Set<string>(cloudEmailPurposeOptions.map((item) => item.value));
