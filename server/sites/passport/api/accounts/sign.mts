import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import type { DatabaseAdapter, DatabaseBatchStatement } from '@server/database/index.mjs';
import { normalizePassportEmail, setPassportPassword, verifyPassportPasswordHistory } from '@server/passport/identity.mjs';
import { hasAccountPassword, setAccountUsername, utcMinutes } from '@server/passport/account.mjs';
import { accountOnboarding, loginRedirectTarget, onboardingForm, refreshOidcRequest, resetPasswordForm } from '@server/accounts/onboarding.mjs';
import { clearPassportSessionCookie, createPassportSessionCookie, loadPassportSession, readPassportSessionId } from '@server/passport/session.mjs';
import { clearOidcRequestCookie, oidcRequestCookieName, readCookie } from '@server/accounts/oidc.mjs';
import { authorizationRequest } from '@server/accounts/repository.mjs';
import { oidcIssuer, revokeOidcSession } from '@server/accounts/provider.mjs';
import { clearExternalPendingCookie, clearPasswordResetCookie, clearSignupEmailCookie, passwordResetCookie, passwordResetCookieName, discardExternalEmailOtp, externalPendingCookieName, externalProviders, providersWithVerifiedEmail, issueExternalEmailOtp, pendingExternalEmailOtp, pendingExternalIdentity, signupEmailCookie, signupEmailCookieName, verifyExternalEmailOtp } from '@server/accounts/external.mjs';
import { isSecureRequest } from '@server/request-origin.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';
import { sendDefaultCloudEmail } from '@server/cloud/email.mjs';
import { sendTelegramMessage, type TelegramInlineKeyboard } from '@server/telegram/api.mjs';
import type { FormPageConfig, FormPageExternalLogin } from '@shared/types/form-page.mjs';

type TelegramOption = {
	account_id: string;
	bot_id: string;
	telegram_user_id: string;
	chat_id: string;
	nickname: string;
};
type Bot = { id: string; name: string; bot_username: string; bot_token: string };
type SelectOption = { value: string; text: string };

/** 登录页：邮箱输入框在上，第三方登录以图标链接的形式排在下方。 */
const signInForm = (email: string, externalLogins: FormPageExternalLogin[], returnHost = ''): FormPageConfig => ({
	description: returnHost
		? `正在为 ${returnHost} 登录。请输入邮箱后点击下一步，未注册的邮箱同样从此处开始；也可以使用下方的第三方账号登录，其中标注推荐的方式无需邮箱验证码即可完成注册。`
		: '请输入邮箱后点击下一步，未注册的邮箱同样从此处开始；也可以使用下方的第三方账号登录，其中标注推荐的方式无需邮箱验证码即可完成注册。',
	submitLabel: '下一步',
	...(returnHost ? { actions: [{ key: 'return_to_client', label: '取消登录' }] } : {}),
	externalLogins,
	initialValues: { step: 'email', email },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'email', label: '邮箱', maxLength: 254, rules: [{ required: true, message: '请输入邮箱' }] },
	],
});
const methodForm = (options: SelectOption[], mode: 'signup' | 'reset' | 'link', email = ''): FormPageConfig => ({
	description: mode === 'link' ? '选择外部身份源，将身份绑定到当前 Accounts 用户。'
		: mode === 'reset' ? `重设 ${email} 的密码需要先完成一次第三方认证，认证通过后才能设置新密码。`
		: `选择一种方式完成认证，认证通过后才会给 ${email} 发送验证码并创建账号。`,
	submitLabel: mode === 'link' ? '绑定身份' : '继续',
	...(mode === 'link' ? {} : { actions: [{ key: 'back_to_sign', label: '返回登录' }] }),
	initialValues: { step: 'method', email, method: options[0]?.value ?? '' },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'email', label: '', type: 'hidden' },
		{ name: 'method', label: mode === 'link' ? '身份源' : '认证方式', type: 'select', options, rules: [{ required: true, message: '请选择一种方式' }] },
	],
});
const passwordLoginForm = (email: string, externalLogins: FormPageExternalLogin[] = []): FormPageConfig => ({
	description: `${email} 已注册，请输入密码登录，或使用下方的第三方账号登录。`,
	submitLabel: '登录',
	actions: [{ key: 'forgot_password', label: '忘记密码' }, { key: 'change_email', label: '更换邮箱' }],
	externalLogins,
	initialValues: { step: 'password', email, password: '' },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'email', label: '', type: 'hidden' },
		{ name: 'password', label: '密码', type: 'password', rules: [{ required: true, message: '请输入密码' }] },
	],
});
/** 已注册但没有设置过密码：只能用第三方登录，不给密码输入框。 */
const externalOnlyForm = (email: string, externalLogins: FormPageExternalLogin[]): FormPageConfig => ({
	description: `${email} 尚未设置密码，请使用下方的第三方账号登录；登录后可在账户中心设置密码。`,
	submitLabel: '更换邮箱',
	externalLogins,
	initialValues: { step: 'restart', email },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'email', label: '邮箱', maxLength: 254, readOnlyWhen: { field: 'step', values: ['restart'] } },
	],
});
const telegramEmailForm = (email = ''): FormPageConfig => ({
	description: '输入已验证邮箱，随后选择已绑定的 Telegram 账号批准登录。',
	submitLabel: '下一步',
	actions: [{ key: 'back_to_sign', label: '返回登录' }],
	initialValues: { step: 'telegram_email', email },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'email', label: '邮箱', maxLength: 254, rules: [{ required: true, message: '请输入已验证邮箱' }] },
	],
});
const confirmEmailForm = (email: string): FormPageConfig => ({
	description: `${email} 还没有注册，请确认邮箱地址是否正确。确认无误后需要先完成一次第三方认证，认证通过才能发送邮箱验证码并绑定到新账号。`,
	submitLabel: '确认无误，继续注册',
	actions: [{ key: 'change_email', label: '重新输入邮箱' }],
	initialValues: { step: 'email_confirm', email },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'email', label: '邮箱', maxLength: 254, readOnlyWhen: { field: 'step', values: ['email_confirm'] }, rules: [{ required: true, message: '请输入邮箱' }] },
	],
});
const telegramForm = (email: string, options: SelectOption[]): FormPageConfig => ({
	description: '请选择用于批准本次网页登录的 Telegram 账号。',
	submitLabel: '发送登录确认',
	initialValues: { step: 'telegram', email, account_id: options.length === 1 ? options[0].value : '' },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'email', label: '', type: 'hidden' },
		{ name: 'account_id', label: 'Telegram 账号', type: 'select', options, rules: [{ required: true, message: '请选择 Telegram 账号' }] },
	],
});
const approvalForm = (challengeId: string, expectedNumber: number): FormPageConfig => ({
	description: `请在 Telegram 消息中点击数字 ${expectedNumber}，然后返回这里完成登录。`,
	submitLabel: '我已批准登录',
	initialValues: { step: 'poll', challenge_id: challengeId },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'challenge_id', label: '', type: 'hidden' },
	],
});
const externalEmailForm = (provider: string, email = ''): FormPageConfig => ({
	description: `${provider}没有提供可直接用于创建 Accounts 用户的已验证邮箱。请确认邮箱并完成验证后再创建账户。`,
	submitLabel: '发送邮箱验证码',
	initialValues: { step: 'external_email', email },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'email', label: '邮箱', maxLength: 254, rules: [{ required: true, message: '请输入邮箱' }] },
	],
});
const externalCodeForm = (email: string): FormPageConfig => ({
	description: `验证码已发送到 ${email}，验证成功后才会创建 Accounts 用户。`,
	submitLabel: '验证并创建账户',
	initialValues: { step: 'external_verify', code: '' },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'code', label: '6 位验证码', maxLength: 6, rules: [{ required: true, message: '请输入验证码' }] },
	],
});

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const parseBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({}));

const loadTelegramOptions = async (database: DatabaseAdapter, globalDatabase: DatabaseAdapter, email: string) => {
	const accounts = await allSql<TelegramOption>(database, sql(database).select({ table: 'passport_emails', alias: 'e', columns: { account_id: { column: 'a.id', cast: 'text' }, bot_id: { column: 'a.bot_id', cast: 'text' }, telegram_user_id: { column: 'a.telegram_user_id', cast: 'text' }, chat_id: { column: 'a.chat_id', cast: 'text' }, nickname: 'a.nickname' }, joins: [{ table: 'passport_user_emails', alias: 'ue', left: 'ue.email_id', right: 'e.id' }, { table: 'passport_users', alias: 'u', left: 'u.user_id', right: 'ue.user_id' }, { table: 'passport_telegram_accounts', alias: 'a', left: 'a.user_id', right: 'u.user_id' }], where: [{ column: 'e.email', value: email }, { column: 'e.verified', value: 1 }, { column: 'u.status', value: 'enabled' }], orderBy: [{ column: 'a.created_at' }] }));
	const bots = await allSql<Bot>(globalDatabase, sql(globalDatabase).select({ table: 'global_telegram_bots', columns: { id: { column: 'id', cast: 'text' }, name: 'name', bot_username: 'bot_username', bot_token: 'bot_token' }, where: [{ column: 'status', value: 'enabled' }] }));
	const botMap = new Map(bots.map((bot) => [bot.id, bot]));
	return accounts.flatMap((account) => {
		const bot = botMap.get(account.bot_id);
		return bot ? [{ account, bot, option: { value: account.account_id, text: `${account.nickname} / @${bot.bot_username} / ${account.telegram_user_id}` } }] : [];
	});
};

/** 邮箱是否已经属于某个启用中的 Accounts 用户。 */
const emailOwnerId = async (database: DatabaseAdapter, email: string) => (
	await firstSql<{ user_id: string }>(database, sql(database).select({
		table: 'passport_emails', alias: 'e',
		columns: { user_id: { column: 'ue.user_id', cast: 'text' } },
		joins: [{ table: 'passport_user_emails', alias: 'ue', left: 'ue.email_id', right: 'e.id' }, { table: 'passport_users', alias: 'u', left: 'u.user_id', right: 'ue.user_id' }],
		where: [{ column: 'e.email', value: email }, { column: 'e.verified', value: 1 }, { column: 'u.status', value: 'enabled' }],
		limit: 1,
	}))
)?.user_id;

const randomNumber = () => {
	const value = new Uint32Array(1);
	crypto.getRandomValues(value);
	return value[0] % 99 + 1;
};
const numberChoices = (expected: number) => {
	const values = new Set([expected]);
	while (values.size < 8) values.add(randomNumber());
	return [...values].sort((left, right) => left - right);
};
const challengeKeyboard = (challengeId: string, expected: number): TelegramInlineKeyboard => ({
	inline_keyboard: [
		numberChoices(expected).map((number) => ({ text: String(number), callback_data: `login:approve:${challengeId}:${number}` })),
		[{ text: '这不是我的操作', callback_data: `login:deny:${challengeId}` }],
	],
});

const handler: ApiHandler = async (c, next) => {
	const database = c.get('passportDatabase'), globalDatabase = c.get('globalDatabase');
	if (!database) return apiMessage(c, 503, 'Passport 数据库不可用');
	const secure = isSecureRequest(c);

	/** 建立 Accounts 会话；会话 Cookie 必须先写，其余 Cookie 追加。 */
	const startSession = async (userId: string) => {
		const sessionId = crypto.randomUUID(), now = Date.now(), maxAge = 24 * 60 * 60;
		await runSql(database, sql(database).insert('passport_sessions', { id: sessionId, user_id: userId, expires_at: now + maxAge * 1000, created_at: now }));
		c.header('Set-Cookie', createPassportSessionCookie(sessionId, secure, maxAge));
		c.header('Set-Cookie', clearSignupEmailCookie(secure), { append: true });
	};

	/** 有待处理的 OIDC 授权请求时，记录来源站点，避免用户跳到 Accounts 后回不去。 */
	const pendingClient = async () => {
		const requestId = readCookie(c.req.raw, oidcRequestCookieName);
		if (!requestId) return undefined;
		const stored = await authorizationRequest(database, requestId);
		if (!stored || stored.expires_at <= Date.now()) return undefined;
		try { return new URL(stored.redirect_uri).origin; }
		catch { return undefined; }
	};

	/** 登录页下方的第三方登录图标。 */
	const signInExternalLogins = async (): Promise<FormPageExternalLogin[]> => {
		const [providers, bot] = await Promise.all([
			externalProviders(database, true),
			firstSql(globalDatabase, sql(globalDatabase).select({ table: 'global_telegram_bots', columns: { id: 'id' }, where: [{ column: 'status', value: 'enabled' }], limit: 1 })),
		]);
		const entries: FormPageExternalLogin[] = [
			...providers.map((provider) => providersWithVerifiedEmail.has(provider.id)
				? { key: provider.id, label: provider.display_name, recommended: true, hint: '新用户无需邮箱验证码' }
				: { key: provider.id, label: provider.display_name }),
			...(bot ? [{ key: 'telegram', label: 'Telegram' }] : []),
		];
		// 推荐的方式排在最前面。
		return entries.sort((left, right) => Number(Boolean(right.recommended)) - Number(Boolean(left.recommended)));
	};
	const providerOptions = async (includeTelegram = false) => {
		const [providers, bot] = await Promise.all([
			externalProviders(database, true),
			includeTelegram ? firstSql(globalDatabase, sql(globalDatabase).select({ table: 'global_telegram_bots', columns: { id: 'id' }, where: [{ column: 'status', value: 'enabled' }], limit: 1 })) : null,
		]);
		return [
			...providers.map((provider) => ({ value: provider.id, text: `使用${provider.display_name}认证` })),
			...(bot ? [{ value: 'telegram', text: 'Telegram 消息批准' }] : []),
		];
	};

	/** 登录成功后依次补全：用户名（必填）、重设密码（三方验证后）、设置密码（可跳过）。 */
	const completeLogin = async (userId: string, message: string) => {
		const onboarding = await accountOnboarding(database, userId);
		const resetting = readCookie(c.req.raw, passwordResetCookieName);
		const formPage = onboarding.step === 'username' ? onboardingForm(onboarding)
			: resetting ? resetPasswordForm()
			: onboarding.step === 'password' ? onboardingForm(onboarding)
			: undefined;
		if (formPage) {
			await refreshOidcRequest(c, database);
			return apiResponse(c, 200, { user: { id: userId }, formPage, currentValues: formPage.initialValues, feedback: { component: 'inline' as const, type: 'success' as const, message } });
		}
		return apiMessageData(c, 200, message, { user: { id: userId }, redirectTo: loginRedirectTarget(c) }, { redirectAfter: 0 });
	};

	if (c.req.method === 'GET') {
		const pendingToken = readCookie(c.req.raw, externalPendingCookieName);
		const signupEmail = readCookie(c.req.raw, signupEmailCookieName) ?? '';
		const [user, providers, pending] = await Promise.all([
			loadPassportSession(database, c.req.raw),
			externalProviders(database, true),
			pendingToken ? pendingExternalIdentity(database, pendingToken) : null,
		]);
		if (user) {
			const onboarding = await accountOnboarding(database, String(user.id));
			const resetting = readCookie(c.req.raw, passwordResetCookieName);
			const pendingForm = onboarding.step === 'username' ? onboardingForm(onboarding)
				: resetting ? resetPasswordForm()
				: onboarding.step === 'password' ? onboardingForm(onboarding)
				: undefined;
			if (pendingForm) {
				await refreshOidcRequest(c, database);
				return apiResponse(c, 200, { user, registrationAvailable: false, formPage: pendingForm, currentValues: pendingForm.initialValues });
			}
			const linkOptions = providers.map((provider) => ({ value: provider.id, text: provider.display_name }));
			return apiResponse(c, 200, { user, registrationAvailable: false, formPage: methodForm(linkOptions, 'link') });
		}
		if (pending) {
			const otp = await pendingExternalEmailOtp(database, pending.id_hash);
			const formPage = otp ? externalCodeForm(otp.email) : externalEmailForm(pending.provider === 'wechat' ? '微信' : '外部身份源', signupEmail);
			return apiResponse(c, 200, { user: null, registrationAvailable: true, formPage, currentValues: formPage.initialValues });
		}
		const client = await pendingClient();
		const formPage = signInForm(signupEmail, await signInExternalLogins(), client ? new URL(client).host : '');
		return apiResponse(c, 200, { user: null, registrationAvailable: providers.length > 0, formPage, currentValues: formPage.initialValues });
	}
	if (c.req.method === 'DELETE') {
		const sessionId = readPassportSessionId(c.req.raw);
		if (sessionId) await revokeOidcSession(database, sessionId, oidcIssuer(c), c.env.OIDC_FETCH ?? fetch);
		c.header('Set-Cookie', clearPassportSessionCookie(secure));
		return apiMessage(c, 200, '已退出 Passport');
	}
	if (c.req.method !== 'POST') return next();
	const body = await parseBody(c), step = text(body.step) || 'email', action = c.req.query('action')?.trim();
	if (!('step' in body) && ('username' in body || 'remember' in body)) return apiMessage(c, 409, '登录方式已切换为 Accounts 登录，请刷新页面后重试');

	/** 登录页的第三方按钮：Telegram 走邮箱 + 消息批准，其余跳转到外部身份源。 */
	if (action?.startsWith('provider:')) {
		const method = action.slice('provider:'.length);
		if (method === 'telegram') {
			const formPage = telegramEmailForm(text(body.email));
			return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues });
		}
		const provider = await externalProviders(database, true).then((items) => items.find((item) => item.id === method));
		if (!provider) return apiMessage(c, 400, '请选择有效的登录方式');
		return apiResponse(c, 200, { redirectTo: `/api/accounts/external/${provider.id}`, feedback: { component: 'message' as const, type: 'success' as const, message: `正在前往${provider.display_name}`, redirectAfter: 0 } });
	}
	if (action === 'change_email' || action === 'back_to_sign') {
		const client = await pendingClient();
		const formPage = signInForm(text(body.email), await signInExternalLogins(), client ? new URL(client).host : '');
		return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues });
	}
	// 取消登录：登录在弹窗里进行，直接关闭窗口；不是弹窗时回落到来源站点。同时清掉待授权请求。
	if (action === 'return_to_client') {
		const client = await pendingClient();
		if (!client) return apiMessage(c, 409, '没有待取消的登录');
		c.header('Set-Cookie', clearOidcRequestCookie(secure));
		return apiResponse(c, 200, { closeWindow: true, redirectTo: client, feedback: { component: 'message' as const, type: 'success' as const, message: '已取消登录', redirectAfter: 0 } });
	}
	if (action === 'forgot_password') {
		let email: string;
		try { email = normalizePassportEmail(text(body.email)); }
		catch { return apiMessage(c, 400, '邮箱格式不正确'); }
		const options = await providerOptions(true);
		if (!options.length) return apiMessage(c, 409, '当前还没有启用可用于认证的外部身份源，请联系管理员');
		c.header('Set-Cookie', passwordResetCookie(email, secure));
		const formPage = methodForm(options, 'reset', email);
		return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues, feedback: { component: 'inline' as const, type: 'info' as const, message: '重设密码需要先完成第三方认证' } });
	}
	if (action === 'skip_password') {
		const user = await loadPassportSession(database, c.req.raw);
		if (!user) return apiMessage(c, 401, '登录状态已失效，请重新登录');
		const pendingOnboarding = await accountOnboarding(database, String(user.id));
		if (pendingOnboarding.step === 'username') {
			const formPage = onboardingForm(pendingOnboarding);
			return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues, feedback: { component: 'inline' as const, type: 'warning' as const, message: '请先设置用户名' } });
		}
		return apiMessageData(c, 200, '已跳过密码设置，下次登录时将再次提示', { user: { id: user.id }, redirectTo: loginRedirectTarget(c) }, { redirectAfter: 0 });
	}
	if (action) return apiMessage(c, 400, '不支持的操作');

	if (step === 'set_username' || step === 'set_password') {
		const user = await loadPassportSession(database, c.req.raw);
		if (!user) return apiMessage(c, 401, '登录状态已失效，请重新登录');
		const userId = String(user.id);
		if (step === 'set_username') {
			try { await setAccountUsername(database, userId, text(body.username)); }
			catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '用户名不合法'); }
			return completeLogin(userId, '用户名已设置');
		}
		const password = String(body.password ?? ''), confirm = String(body.password_confirm ?? '');
		if (password !== confirm) return apiMessage(c, 400, '两次输入的密码不一致');
		try { await setPassportPassword(database, userId, password); }
		catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '密码不合法'); }
		return completeLogin(userId, '密码已设置，下次可使用邮箱和密码登录');
	}

	if (step === 'external_email' || step === 'external_verify') {
		const pendingToken = readCookie(c.req.raw, externalPendingCookieName);
		const pending = pendingToken ? await pendingExternalIdentity(database, pendingToken) : null;
		if (!pending) return apiMessage(c, 409, '外部身份验证已过期，请重新扫码授权');
		if (step === 'external_email') {
			let issued: Awaited<ReturnType<typeof issueExternalEmailOtp>>;
			try { issued = await issueExternalEmailOtp(database, pending, text(body.email)); }
			catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '邮箱或发送频率不合法'); }
			try {
				await sendDefaultCloudEmail(globalDatabase, c.get('site').siteKey, 'email_verification', issued.email, { code: issued.code, email: issued.email, expires_minutes: '10' });
			} catch (error) {
				await discardExternalEmailOtp(database, pending.id_hash);
				return apiMessage(c, 502, error instanceof Error ? error.message : '邮箱验证码发送失败');
			}
			const formPage = externalCodeForm(issued.email);
			return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues, feedback: { component: 'inline' as const, type: 'success' as const, message: '验证码已发送' } });
		}
		const verified = await verifyExternalEmailOtp(database, c.env.SNOWFLAKE_WORKER_ID, pending, text(body.code));
		if (verified.status !== 'created') {
			const message = verified.status === 'conflict' ? verified.message : verified.status === 'expired' ? '验证码已过期，请重新发送' : verified.status === 'locked' ? '验证码错误次数过多，请重新发送' : '验证码不正确';
			return apiMessage(c, 409, message);
		}
		await startSession(verified.userId);
		c.header('Set-Cookie', clearExternalPendingCookie(secure), { append: true });
		return completeLogin(verified.userId, 'Accounts 用户已创建并登录');
	}

	if (step === 'email') {
		let email: string;
		try { email = normalizePassportEmail(text(body.email)); }
		catch { return apiMessage(c, 400, '邮箱格式不正确'); }
		const userId = await emailOwnerId(database, email);
		if (userId) {
			// 没设置过密码的账号不能走密码登录，直接引导到第三方登录。
			const externalLogins = await signInExternalLogins();
			const formPage = await hasAccountPassword(database, userId)
				? passwordLoginForm(email, externalLogins)
				: externalOnlyForm(email, externalLogins);
			return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues });
		}
		const formPage = confirmEmailForm(email);
		return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues, feedback: { component: 'inline' as const, type: 'warning' as const, message: '该邮箱还没有注册' } });
	}

	if (step === 'restart') {
		const client = await pendingClient();
		const formPage = signInForm(text(body.email), await signInExternalLogins(), client ? new URL(client).host : '');
		return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues });
	}

	if (step === 'reset_password') {
		const user = await loadPassportSession(database, c.req.raw);
		if (!user) return apiMessage(c, 401, '登录状态已失效，请重新登录');
		if (!readCookie(c.req.raw, passwordResetCookieName)) return apiMessage(c, 409, '重设密码需要先完成第三方认证');
		const password = String(body.password ?? ''), confirm = String(body.password_confirm ?? '');
		if (password !== confirm) return apiMessage(c, 400, '两次输入的新密码不一致');
		try { await setPassportPassword(database, String(user.id), password); }
		catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '密码不合法'); }
		c.header('Set-Cookie', clearPasswordResetCookie(secure), { append: true });
		return completeLogin(String(user.id), '密码已重设');
	}

	if (step === 'email_confirm') {
		let email: string;
		try { email = normalizePassportEmail(text(body.email)); }
		catch { return apiMessage(c, 400, '邮箱格式不正确'); }
		const owner = await emailOwnerId(database, email);
		if (owner) {
			const externalLogins = await signInExternalLogins();
			const formPage = await hasAccountPassword(database, owner)
				? passwordLoginForm(email, externalLogins)
				: externalOnlyForm(email, externalLogins);
			return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues, feedback: { component: 'inline' as const, type: 'info' as const, message: '该邮箱已经注册，请直接登录' } });
		}
		const providers = await externalProviders(database, true);
		if (!providers.length) return apiMessage(c, 409, '当前还没有启用可用于注册的外部身份源，请联系管理员');
		c.header('Set-Cookie', signupEmailCookie(email, secure));
		const formPage = methodForm(providers.map((provider) => ({ value: provider.id, text: `使用${provider.display_name}认证` })), 'signup', email);
		return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues });
	}

	if (step === 'method') {
		const method = text(body.method);
		const user = await loadPassportSession(database, c.req.raw);
		const knownEmail = text(body.email);
		if (method === 'telegram') {
			const formPage = telegramEmailForm(knownEmail);
			return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues });
		}
		const provider = await externalProviders(database, true).then((items) => items.find((item) => item.id === method));
		if (!provider) return apiMessage(c, 400, '请选择有效的登录方式');
		return apiResponse(c, 200, { redirectTo: `/api/accounts/external/${provider.id}`, feedback: { component: 'message' as const, type: 'success' as const, message: user ? `正在前往${provider.display_name}绑定` : `正在前往${provider.display_name}`, redirectAfter: 0 } });
	}

	if (step === 'telegram_email') {
		let email: string;
		try { email = normalizePassportEmail(text(body.email)); }
		catch { return apiMessage(c, 400, '邮箱格式不正确'); }
		const options = await loadTelegramOptions(database, globalDatabase, email);
		if (!options.length) return apiMessage(c, 404, '未找到该邮箱对应的可用 Telegram 登录身份');
		const formPage = telegramForm(email, options.map((item) => item.option));
		return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues });
	}

	if (step === 'password') {
		let email: string;
		try { email = normalizePassportEmail(text(body.email)); }
		catch { return apiMessage(c, 400, '邮箱格式不正确'); }
		const userId = await emailOwnerId(database, email);
		if (!userId) {
			const formPage = confirmEmailForm(email);
			return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues, feedback: { component: 'inline' as const, type: 'warning' as const, message: '该邮箱还没有注册' } });
		}
		if (!await hasAccountPassword(database, userId)) return apiMessage(c, 409, '该账号尚未设置密码，请先使用微信、Telegram 或 Google 登录，再前往账户中心设置密码');
		const verified = await verifyPassportPasswordHistory(database, userId, String(body.password ?? ''));
		if (verified.status === 'old') return apiMessage(c, 401, `密码已于 ${utcMinutes(verified.changedAt)} 修改，请使用新密码登录`);
		if (verified.status !== 'current') return apiMessage(c, 401, '邮箱或密码不正确。忘记密码请使用微信、Telegram 或 Google 登录后，前往账户中心重设');
		await startSession(userId);
		return completeLogin(userId, 'Accounts 登录成功');
	}

	if (step === 'telegram') {
		let email: string;
		try { email = normalizePassportEmail(text(body.email)); }
		catch { return apiMessage(c, 400, '邮箱格式不正确'); }
		const accountId = text(body.account_id), options = await loadTelegramOptions(database, globalDatabase, email);
		const selected = options.find((item) => item.account.account_id === accountId);
		if (!selected) return apiMessage(c, 400, 'Telegram 登录身份无效');
		const owner = await firstSql<{ user_id: string }>(database, sql(database).select({ table: 'passport_telegram_accounts', alias: 'a', columns: { user_id: { column: 'a.user_id', cast: 'text' } }, joins: [{ table: 'passport_users', alias: 'u', left: 'u.user_id', right: 'a.user_id' }], where: [{ column: 'a.id', value: accountId }, { column: 'u.status', value: 'enabled' }] }));
		if (!owner) return apiMessage(c, 409, 'Passport 用户已停用或不存在');
		const challengeId = crypto.randomUUID(), expectedNumber = randomNumber(), now = Date.now();
		await runSql(database, sql(database).update('passport_login_challenges', { status: 'expired', updated_at: now }, { bot_id: selected.bot.id, telegram_user_id: selected.account.telegram_user_id, status: 'pending' }));
		await runSql(database, sql(database).insert('passport_login_challenges', { id: challengeId, user_id: owner.user_id, bot_id: selected.bot.id, telegram_user_id: selected.account.telegram_user_id, chat_id: selected.account.chat_id, expected_number: expectedNumber, status: 'pending', expires_at: now + 10 * 60_000, created_at: now, updated_at: now }));
		try {
			await sendTelegramMessage(selected.bot.bot_token, selected.account.chat_id,
				`网页登录确认：请点击网页显示的数字。若不是本人操作，请点击“这不是我的操作”。`, challengeKeyboard(challengeId, expectedNumber));
		} catch (error) {
			await runSql(database, sql(database).update('passport_login_challenges', { status: 'expired', updated_at: Date.now() }, { id: challengeId }));
			return apiMessage(c, 502, error instanceof Error ? error.message : 'Telegram 登录确认发送失败');
		}
		const formPage = approvalForm(challengeId, expectedNumber);
		return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues, feedback: { component: 'inline' as const, type: 'info' as const, message: '登录确认已发送到 Telegram' } });
	}

	if (step === 'poll') {
		const challengeId = text(body.challenge_id);
		if (!/^[0-9a-f-]{36}$/i.test(challengeId)) return apiMessage(c, 400, '登录确认编号不合法');
		const challenge = await firstSql<{ user_id: string; expected_number: number; status: string; expires_at: number }>(database, sql(database).select({ table: 'passport_login_challenges', columns: { user_id: { column: 'user_id', cast: 'text' }, expected_number: 'expected_number', status: 'status', expires_at: 'expires_at' }, where: [{ column: 'id', value: challengeId }] }));
		if (!challenge) return apiMessage(c, 404, '登录确认不存在');
		if (challenge.expires_at <= Date.now() && challenge.status === 'pending') {
			await runSql(database, sql(database).update('passport_login_challenges', { status: 'expired', updated_at: Date.now() }, { id: challengeId, status: 'pending' }));
			return apiMessage(c, 409, '登录确认已过期，请重新开始');
		}
		if (challenge.status === 'pending') {
			const formPage = approvalForm(challengeId, challenge.expected_number);
			return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues, feedback: { component: 'inline' as const, type: 'warning' as const, message: '尚未收到 Telegram 批准，请确认数字后重试' } });
		}
		if (challenge.status !== 'approved') return apiMessage(c, 409, challenge.status === 'denied' ? '本次登录已被拒绝' : '登录确认已经失效');
		const sessionId = crypto.randomUUID(), now = Date.now(), maxAge = 24 * 60 * 60;
		if (!database.batch) return apiMessage(c, 500, 'Passport 数据库不支持原子登录');
		const builder = sql(database);
		const statements: DatabaseBatchStatement[] = [
			builder.insertFromSelect('passport_sessions', { id: sessionId, user_id: { column: 'user_id' }, expires_at: now + maxAge * 1000, created_at: now }, 'passport_login_challenges', [{ column: 'id', value: challengeId }, { column: 'status', value: 'approved' }]),
			builder.update('passport_login_challenges', { status: 'consumed', updated_at: now }, { id: challengeId, status: 'approved' }),
		];
		await database.batch(statements);
		const createdSession = await firstSql(database, builder.select({ table: 'passport_sessions', columns: { id: 'id' }, where: [{ column: 'id', value: sessionId }] }));
		if (!createdSession) return apiMessage(c, 409, '登录确认已被使用');
		c.header('Set-Cookie', createPassportSessionCookie(sessionId, secure, maxAge));
		c.header('Set-Cookie', clearSignupEmailCookie(secure), { append: true });
		return completeLogin(challenge.user_id, 'Accounts 登录成功');
	}
	return apiMessage(c, 400, '不支持的登录步骤');
};

export default handler;
