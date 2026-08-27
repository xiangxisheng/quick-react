import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { hasAccountPassword, utcMinutes } from '@server/passport/account.mjs';
import { setPassportPassword, verifyPassportPasswordHistory } from '@server/passport/identity.mjs';
import type { FormPageConfig } from '@shared/types/form-page.mjs';

const securityForm = (hasPassword: boolean): FormPageConfig => ({
	description: hasPassword
		? '修改密码需要先输入当前密码。修改后旧密码立即失效。'
		: '还没有设置密码。设置后可以直接用邮箱和密码登录 Accounts。',
	submitLabel: hasPassword ? '修改密码' : '设置密码',
	initialValues: { current_password: '', password: '', password_confirm: '' },
	fields: [
		...(hasPassword ? [{ name: 'current_password', label: '当前密码', type: 'password' as const, rules: [{ required: true, message: '请输入当前密码' }] }] : []),
		{ name: 'password', label: '新密码', type: 'password' as const, placeholder: '至少 8 个字符', rules: [{ required: true, message: '请输入新密码' }] },
		{ name: 'password_confirm', label: '确认新密码', type: 'password' as const, rules: [{ required: true, message: '请再次输入新密码' }] },
	],
});

const handler: ApiHandler = async (c, next) => {
	const database = c.get('passportDatabase')!, userId = String(c.get('passportUser')!.id);
	if (c.req.method === 'GET') {
		const formPage = securityForm(await hasAccountPassword(database, userId));
		return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues });
	}
	if (c.req.method !== 'PUT') return next();
	const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
	const password = String(body.password ?? ''), confirm = String(body.password_confirm ?? '');
	const hasPassword = await hasAccountPassword(database, userId);
	if (hasPassword) {
		const verified = await verifyPassportPasswordHistory(database, userId, String(body.current_password ?? ''));
		if (verified.status === 'old') return apiMessage(c, 401, `当前密码已于 ${utcMinutes(verified.changedAt)} 修改，请输入最新密码`);
		if (verified.status !== 'current') return apiMessage(c, 401, '当前密码不正确');
	}
	if (password !== confirm) return apiMessage(c, 400, '两次输入的新密码不一致');
	try { await setPassportPassword(database, userId, password); }
	catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '密码不合法'); }
	const formPage = securityForm(true);
	return apiMessageData(c, 200, hasPassword ? '密码已修改' : '密码已设置，下次可以直接用邮箱和密码登录', { formPage, currentValues: formPage.initialValues });
};

export default handler;
