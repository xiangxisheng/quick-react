import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/modules/base/api-response.mjs';
import { loadAccountProfile, updateAccountNickname } from '@server/modules/passport/account.mjs';
import type { FormPageConfig } from '@shared/types/form-page.mjs';

const profileForm = (): FormPageConfig => ({
	description: '昵称最多 12 个字符。用户名设置后不能修改，需要更换请联系管理员。',
	submitLabel: '保存',
	initialValues: { locked: '1', username: '', nickname: '', primary_email: '' },
	fields: [
		{ name: 'locked', label: '', type: 'hidden' },
		{ name: 'username', label: '用户名', readOnlyWhen: { field: 'locked', values: ['1'] } },
		{ name: 'nickname', label: '昵称', maxLength: 12, rules: [{ required: true, message: '请输入昵称' }] },
		{ name: 'primary_email', label: '主邮箱', readOnlyWhen: { field: 'locked', values: ['1'] } },
	],
});

const handler: ApiHandler = async (c, next) => {
	const database = c.get('passportDatabase')!, userId = String(c.get('passportUser')!.id);
	if (c.req.method === 'GET') {
		const profile = await loadAccountProfile(database, userId);
		return apiResponse(c, 200, {
			formPage: profileForm(),
			currentValues: { locked: '1', username: profile.username ?? '未设置', nickname: profile.nickname, primary_email: profile.primaryEmail || '未设置' },
		});
	}
	if (c.req.method !== 'PUT') return next();
	const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
	let nickname: string;
	try { nickname = await updateAccountNickname(database, userId, String(body.nickname ?? '')); }
	catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '昵称不合法'); }
	const profile = await loadAccountProfile(database, userId);
	return apiMessageData(c, 200, '资料已保存', {
		currentValues: { locked: '1', username: profile.username ?? '未设置', nickname, primary_email: profile.primaryEmail || '未设置' },
	});
};

export default handler;
