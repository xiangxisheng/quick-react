import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { AccountEmailRateLimitError, discardAccountEmailOtp, issueAccountEmailOtp, pendingAccountEmailOtp, verifyAccountEmailOtp } from '@server/passport/account.mjs';
import { externalProviders, externalVerifiedCookieName } from '@server/accounts/external.mjs';
import { readCookie } from '@server/accounts/oidc.mjs';
import { sendDefaultCloudEmail } from '@server/cloud/email.mjs';
import type { FormPageConfig } from '@shared/types/form-page.mjs';

const verifyIdentityForm = (actions: Array<{ key: string; label: string }>): FormPageConfig => ({
	description: '发送邮箱验证码之前必须先完成一次第三方认证。请选择下面任意一种方式完成认证，认证后 30 分钟内可以绑定新邮箱。',
	submitLabel: '我已完成认证，继续',
	actions,
	initialValues: { step: 'check' },
	fields: [{ name: 'step', label: '', type: 'hidden' }],
});
const emailForm = (): FormPageConfig => ({
	description: '第三方认证已通过。输入要绑定的邮箱，验证码会发送到该邮箱。',
	submitLabel: '发送验证码',
	initialValues: { step: 'send', email: '' },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'email', label: '邮箱', maxLength: 254, rules: [{ required: true, message: '请输入邮箱' }] },
	],
});
const codeForm = (email: string): FormPageConfig => ({
	description: `验证码已发送到 ${email}，输入验证码完成绑定。`,
	submitLabel: '完成绑定',
	actions: [{ key: 'restart', label: '换个邮箱' }],
	initialValues: { step: 'verify', code: '' },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'code', label: '6 位验证码', maxLength: 6, rules: [{ required: true, message: '请输入验证码' }] },
	],
});

const handler: ApiHandler = async (c, next) => {
	const database = c.get('passportDatabase')!, userId = String(c.get('passportUser')!.id);
	const verified = Boolean(readCookie(c.req.raw, externalVerifiedCookieName));
	const currentForm = async () => {
		if (!verified) {
			const providers = await externalProviders(database, true);
			if (!providers.length) return verifyIdentityForm([]);
			return verifyIdentityForm(providers.map((provider) => ({ key: `provider:${provider.id}`, label: `使用${provider.display_name}认证` })));
		}
		const pending = await pendingAccountEmailOtp(database, userId);
		return pending ? codeForm(pending.email) : emailForm();
	};
	if (c.req.method === 'GET') {
		const formPage = await currentForm();
		return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues });
	}
	if (c.req.method !== 'POST' && c.req.method !== 'PUT') return next();
	const action = c.req.query('action')?.trim();
	const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));

	if (action?.startsWith('provider:')) {
		const provider = await externalProviders(database, true).then((items) => items.find((item) => item.id === action.slice('provider:'.length)));
		if (!provider) return apiMessage(c, 400, '外部身份源不存在或未启用');
		return apiResponse(c, 200, { redirectTo: `/api/accounts/external/${provider.id}`, feedback: { component: 'message' as const, type: 'success' as const, message: `正在前往${provider.display_name}认证`, redirectAfter: 0 } });
	}
	if (action === 'restart') {
		await discardAccountEmailOtp(database, userId);
		const formPage = await currentForm();
		return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues });
	}
	if (action) return apiMessage(c, 400, '不支持的操作');

	const step = typeof body.step === 'string' ? body.step : 'check';
	if (step === 'check') {
		const formPage = await currentForm();
		return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues, ...(verified ? {} : { feedback: { component: 'inline' as const, type: 'warning' as const, message: '还没有完成第三方认证' } }) });
	}
	if (!verified) return apiMessage(c, 403, '发送验证码前必须先完成第三方认证');
	if (step === 'send') {
		let issued: Awaited<ReturnType<typeof issueAccountEmailOtp>>;
		try { issued = await issueAccountEmailOtp(database, userId, String(body.email ?? '')); }
		catch (error) {
			const status = error instanceof AccountEmailRateLimitError ? 429 : 400;
			return apiMessage(c, status, error instanceof Error ? error.message : '邮箱不合法');
		}
		try {
			await sendDefaultCloudEmail(c.get('globalDatabase'), 'passport', 'email_verification', issued.email, { code: issued.code, email: issued.email, expires_minutes: '10' });
		} catch (error) {
			await discardAccountEmailOtp(database, userId);
			return apiMessage(c, 502, error instanceof Error ? error.message : '邮箱验证码发送失败');
		}
		const formPage = codeForm(issued.email);
		return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues, feedback: { component: 'inline' as const, type: 'success' as const, message: '验证码已发送' } });
	}
	if (step === 'verify') {
		const result = await verifyAccountEmailOtp(database, c.env.SNOWFLAKE_WORKER_ID, userId, String(body.code ?? ''));
		if (result.status === 'bound') {
			const formPage = emailForm();
			return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues, feedback: { component: 'inline' as const, type: 'success' as const, message: `${result.email} 已绑定，可以在邮箱管理里设为主邮箱` } });
		}
		if (result.status === 'conflict') return apiMessage(c, 409, result.message);
		if (result.status === 'none') return apiMessage(c, 409, '没有待验证的邮箱，请重新发送验证码');
		if (result.status === 'expired') return apiMessage(c, 409, '验证码已过期，请重新发送');
		if (result.status === 'locked') return apiMessage(c, 409, '验证码错误次数过多，请重新发送');
		return apiMessage(c, 409, '验证码不正确');
	}
	return apiMessage(c, 400, '不支持的步骤');
};

export default handler;
