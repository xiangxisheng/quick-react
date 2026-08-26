import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import type { DatabaseAdapter, DatabaseBatchStatement } from '@server/database/index.mjs';
import { normalizePassportEmail } from '@server/passport/identity.mjs';
import { clearPassportSessionCookie, createPassportSessionCookie, loadPassportSession, readPassportSessionId } from '@server/passport/session.mjs';
import { clearOidcRequestCookie, oidcRequestCookieName, readCookie } from '@server/accounts/oidc.mjs';
import { oidcIssuer, revokeOidcSession } from '@server/accounts/provider.mjs';
import { clearExternalPendingCookie, discardExternalEmailOtp, externalPendingCookieName, externalProviders, issueExternalEmailOtp, pendingExternalEmailOtp, pendingExternalIdentity, verifyExternalEmailOtp } from '@server/accounts/external.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';
import { sendDefaultCloudEmail } from '@server/cloud/email.mjs';
import { sendTelegramMessage, type TelegramInlineKeyboard } from '@server/telegram/api.mjs';
import type { FormPageConfig } from '@shared/types/form-page.mjs';

type TelegramOption = {
	account_id: string;
	bot_id: string;
	telegram_user_id: string;
	chat_id: string;
	nickname: string;
};
type Bot = { id: string; name: string; bot_username: string; bot_token: string };

const methodForm = (options: Array<{ value: string; text: string }>, linking: boolean): FormPageConfig => ({
	description: linking ? '选择外部身份源，将身份绑定到当前 Accounts 用户。' : '选择一种方式登录 Accounts。',
	submitLabel: linking ? '绑定身份' : '继续登录',
	initialValues: { step: 'method', method: options[0]?.value ?? '' },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'method', label: '登录方式', type: 'select', options, rules: [{ required: true, message: '请选择登录方式' }] },
	],
});
const emailForm = (): FormPageConfig => ({
	description: '输入已验证邮箱，随后选择已绑定的 Telegram 账号批准登录。',
	submitLabel: '下一步',
	initialValues: { step: 'email', email: '' },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'email', label: '邮箱', maxLength: 254, rules: [{ required: true, message: '请输入已验证邮箱' }] },
	],
});
const telegramForm = (email: string, options: Array<{ value: string; text: string }>): FormPageConfig => ({
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
const externalEmailForm = (provider: string): FormPageConfig => ({
	description: `${provider}没有提供可直接用于创建 Accounts 用户的已验证邮箱。请输入邮箱并完成验证后再创建账户。`,
	submitLabel: '发送邮箱验证码',
	initialValues: { step: 'external_email', email: '' },
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
	if (c.get('site').siteKey !== 'passport') return apiMessage(c, 404, 'Passport 身份登录仅在 Passport 站点可用');
	const database = c.get('passportDatabase'), globalDatabase = c.get('globalDatabase');
	if (!database) return apiMessage(c, 503, 'Passport 数据库不可用');
	if (c.req.method === 'GET') {
		const pendingToken = readCookie(c.req.raw, externalPendingCookieName);
		const [user, providers, bots, pending] = await Promise.all([
			loadPassportSession(database, c.req.raw), externalProviders(database, true),
			firstSql(globalDatabase, sql(globalDatabase).select({ table: 'global_telegram_bots', columns: { id: 'id' }, where: [{ column: 'status', value: 'enabled' }], limit: 1 })),
			pendingToken ? pendingExternalIdentity(database, pendingToken) : null,
		]);
		if (pending && !user) {
			const otp = await pendingExternalEmailOtp(database, pending.id_hash);
			const formPage = otp ? externalCodeForm(otp.email) : externalEmailForm(pending.provider === 'wechat' ? '微信' : '外部身份源');
			return apiResponse(c, 200, { user: null, registrationAvailable: true, formPage, currentValues: formPage.initialValues });
		}
		const options = [
			...(!user && bots ? [{ value: 'telegram', text: 'Telegram 消息批准' }] : []),
			...providers.map((provider) => ({ value: provider.id, text: provider.display_name })),
		];
		return apiResponse(c, 200, { user: user ?? null, registrationAvailable: options.length > 0, formPage: methodForm(options, Boolean(user)) });
	}
	if (c.req.method === 'DELETE') {
		const sessionId = readPassportSessionId(c.req.raw);
		if (sessionId) await revokeOidcSession(database, sessionId, oidcIssuer(c), c.env.OIDC_FETCH ?? fetch);
		c.header('Set-Cookie', clearPassportSessionCookie(new URL(c.req.url).protocol === 'https:'));
		return apiMessage(c, 200, '已退出 Passport');
	}
	if (c.req.method !== 'POST') return next();
	const body = await parseBody(c), step = text(body.step) || 'email';
	if (step === 'external_email' || step === 'external_verify') {
		const pendingToken = readCookie(c.req.raw, externalPendingCookieName);
		const pending = pendingToken ? await pendingExternalIdentity(database, pendingToken) : null;
		if (!pending) return apiMessage(c, 409, '外部身份验证已过期，请重新扫码授权');
		if (step === 'external_email') {
			let issued: Awaited<ReturnType<typeof issueExternalEmailOtp>>;
			try { issued = await issueExternalEmailOtp(database, pending, text(body.email)); }
			catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '邮箱或发送频率不合法'); }
			try {
				await sendDefaultCloudEmail(globalDatabase, 'passport', 'email_verification', issued.email, { code: issued.code, email: issued.email, expires_minutes: '10' });
			} catch (error) {
				await discardExternalEmailOtp(database, pending.id_hash);
				return apiMessage(c, 502, error instanceof Error ? error.message : '邮箱验证码发送失败');
			}
			const formPage = externalCodeForm(issued.email);
			return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues, feedback: { component: 'inline', type: 'success', message: '验证码已发送' } });
		}
		const verified = await verifyExternalEmailOtp(database, c.env.SNOWFLAKE_WORKER_ID, pending, text(body.code));
		if (verified.status !== 'created') {
			const message = verified.status === 'conflict' ? verified.message : verified.status === 'expired' ? '验证码已过期，请重新发送' : verified.status === 'locked' ? '验证码错误次数过多，请重新发送' : '验证码不正确';
			return apiMessage(c, 409, message);
		}
		const sessionId = crypto.randomUUID(), now = Date.now(), maxAge = 24 * 60 * 60, secure = new URL(c.req.url).protocol === 'https:';
		await runSql(database, sql(database).insert('passport_sessions', { id: sessionId, user_id: verified.userId, expires_at: now + maxAge * 1000, created_at: now }));
		c.header('Set-Cookie', createPassportSessionCookie(sessionId, secure, maxAge));
		c.header('Set-Cookie', clearExternalPendingCookie(secure), { append: true });
		const oidcRequestId = readCookie(c.req.raw, oidcRequestCookieName);
		if (oidcRequestId) c.header('Set-Cookie', clearOidcRequestCookie(secure), { append: true });
		return apiMessageData(c, 200, 'Accounts 用户已创建并登录', { user: { id: verified.userId }, ...(oidcRequestId ? { redirectTo: `/api/oidc/authorize?request_id=${encodeURIComponent(oidcRequestId)}` } : { redirectTo: '/' }) }, { redirectAfter: 0 });
	}
	if (step === 'method') {
		const method = text(body.method);
		if (method === 'telegram') {
			const formPage = emailForm();
			return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues });
		}
		if (method === 'google' || method === 'wechat') {
			const provider = await externalProviders(database, true).then((items) => items.find((item) => item.id === method));
			if (!provider) return apiMessage(c, 400, `${method === 'google' ? 'Google' : '微信'}登录尚未启用`);
			return apiResponse(c, 200, { redirectTo: `/api/accounts/external/${method}`, feedback: { component: 'message', type: 'success', message: `正在前往${provider.display_name}`, redirectAfter: 0 } });
		}
		return apiMessage(c, 400, '请选择有效的登录方式');
	}
	if (step === 'email') {
		let email: string;
		try { email = normalizePassportEmail(text(body.email)); }
		catch { return apiMessage(c, 400, '邮箱格式不正确'); }
		const options = await loadTelegramOptions(database, globalDatabase, email);
		if (!options.length) return apiMessage(c, 404, '未找到该邮箱对应的可用 Telegram 登录身份');
		return apiResponse(c, 200, { formPage: telegramForm(email, options.map((item) => item.option)), currentValues: telegramForm(email, options.map((item) => item.option)).initialValues });
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
		return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues, feedback: { component: 'inline', type: 'info', message: '登录确认已发送到 Telegram' } });
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
			return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues, feedback: { component: 'inline', type: 'warning', message: '尚未收到 Telegram 批准，请确认数字后重试' } });
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
		const secure = new URL(c.req.url).protocol === 'https:';
		c.header('Set-Cookie', createPassportSessionCookie(sessionId, secure, maxAge));
		const oidcRequestId = readCookie(c.req.raw, oidcRequestCookieName);
		if (oidcRequestId) c.header('Set-Cookie', clearOidcRequestCookie(secure), { append: true });
		return apiMessageData(c, 200, 'Accounts 登录成功', {
			user: { id: challenge.user_id },
			...(oidcRequestId ? { redirectTo: `/api/oidc/authorize?request_id=${encodeURIComponent(oidcRequestId)}` } : {}),
		}, { redirectAfter: 0 });
	}
	return apiMessage(c, 400, '不支持的登录步骤');
};

export default handler;
