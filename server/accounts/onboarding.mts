import type { Context } from 'hono';
import type { AppEnv } from '@server/types.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import type { FormPageConfig } from '@shared/types/form-page.mjs';
import { runSql, sql } from '@server/database/sql.mjs';
import { clearOidcRequestCookie, oidcRequestCookie, oidcRequestCookieName, readCookie } from '@server/accounts/oidc.mjs';
import { isSecureRequest } from '@server/request-origin.mjs';
import { accountUsernameState, hasAccountPassword } from '@server/passport/account.mjs';

export type OnboardingStep = 'username' | 'password' | 'done';
export type AccountOnboarding = { step: OnboardingStep; invalidUsername: string };

/**
 * 登录成功后必须补全的内容：用户名必填（占位或历史用户名也要改成合法用户名），
 * 密码可跳过，但每次登录都会再问。
 */
export const accountOnboarding = async (database: DatabaseAdapter, userId: string): Promise<AccountOnboarding> => {
	const username = await accountUsernameState(database, userId);
	if (username.state !== 'ready') return { step: 'username', invalidUsername: username.state === 'invalid' ? username.username : '' };
	if (!await hasAccountPassword(database, userId)) return { step: 'password', invalidUsername: '' };
	return { step: 'done', invalidUsername: '' };
};

export const usernameForm = (invalidUsername = ''): FormPageConfig => ({
	description: invalidUsername
		? `当前用户名 ${invalidUsername} 不符合规则，请改成以小写字母开头、只包含小写字母和数字、长度 6 到 12 位的用户名后再继续。`
		: '请为账号设置用户名：以小写字母开头，只能包含小写字母和数字，长度 6 到 12 位。设置后不能修改。',
	submitLabel: '保存用户名',
	initialValues: { step: 'set_username', username: '' },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'username', label: '用户名', maxLength: 12, placeholder: '例如 alice2026', rules: [{ required: true, message: '请输入用户名' }] },
	],
});

export const passwordForm = (): FormPageConfig => ({
	description: '设置密码后，下次可以直接用邮箱和密码登录。也可以跳过，下次登录会再次提醒。',
	submitLabel: '保存密码',
	actions: [{ key: 'skip_password', label: '暂时跳过' }],
	initialValues: { step: 'set_password', password: '', password_confirm: '' },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'password', label: '密码', type: 'password', placeholder: '至少 8 个字符', rules: [{ required: true, message: '请输入密码' }] },
		{ name: 'password_confirm', label: '确认密码', type: 'password', rules: [{ required: true, message: '请再次输入密码' }] },
	],
});

export const onboardingForm = (onboarding: AccountOnboarding) => onboarding.step === 'username' ? usernameForm(onboarding.invalidUsername) : passwordForm();

/**
 * 补全步骤会延长登录耗时，而 OIDC 授权请求和 cookie 的有效期都是 10 分钟，
 * 进入补全步骤时给两者一起续期，避免补全完成后回跳授权失败。
 */
export const refreshOidcRequest = async (c: Context<AppEnv>, database: DatabaseAdapter) => {
	const requestId = readCookie(c.req.raw, oidcRequestCookieName);
	if (!requestId) return;
	await runSql(database, sql(database).update('passport_oidc_authorization_requests', { expires_at: Date.now() + 600_000 }, { id: requestId }));
	c.header('Set-Cookie', oidcRequestCookie(requestId, isSecureRequest(c)), { append: true });
};

/** 登录流程真正结束时才清除 OIDC cookie 并给出回跳目标。 */
export const loginRedirectTarget = (c: Context<AppEnv>) => {
	const requestId = readCookie(c.req.raw, oidcRequestCookieName);
	if (!requestId) return '/';
	c.header('Set-Cookie', clearOidcRequestCookie(isSecureRequest(c)), { append: true });
	return `/api/oidc/authorize?request_id=${encodeURIComponent(requestId)}`;
};
