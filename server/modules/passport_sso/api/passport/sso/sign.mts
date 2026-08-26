import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import type { DatabaseAdapter, DatabaseBatchStatement } from '@server/database/index.mjs';
import { normalizePassportEmail } from '@server/passport/identity.mjs';
import { clearPassportSessionCookie, createPassportSessionCookie, loadPassportSession, readPassportSessionId } from '@server/passport/session.mjs';
import { clearSsoRequestCookie, issuePassportLoginTicket, passportSsoRequestCookieName, readNamedCookie } from '@server/passport/sso.mjs';
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
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const parseBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({}));
const loadTelegramOptions = async (database: DatabaseAdapter, globalDatabase: DatabaseAdapter, email: string) => {
	const accounts = await database.prepare(`SELECT CAST(a.id AS TEXT) AS account_id, CAST(a.bot_id AS TEXT) AS bot_id,
		CAST(a.telegram_user_id AS TEXT) AS telegram_user_id, CAST(a.chat_id AS TEXT) AS chat_id, a.nickname
		FROM passport_emails e JOIN passport_user_emails ue ON ue.email_id = e.id
		JOIN passport_users u ON u.user_id = ue.user_id JOIN passport_telegram_accounts a ON a.user_id = u.user_id
		WHERE e.email = ?1 AND e.verified = 1 AND u.status = 'enabled' ORDER BY a.created_at`)
		.bind(email).all<TelegramOption>();
	const bots = await globalDatabase.prepare(`SELECT CAST(id AS TEXT) AS id, name, bot_username, bot_token
		FROM global_telegram_bots WHERE status = 'enabled'`).all<Bot>();
	const botMap = new Map(bots.results.map((bot) => [bot.id, bot]));
	return accounts.results.flatMap((account) => {
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
	if (c.req.method === 'GET') return apiResponse(c, 200, { user: await loadPassportSession(database, c.req.raw) ?? null, registrationAvailable: false, formPage: emailForm() });
	if (c.req.method === 'DELETE') {
		const sessionId = readPassportSessionId(c.req.raw);
		if (sessionId) await database.prepare(`DELETE FROM passport_sessions WHERE id = ?1`).bind(sessionId).run();
		c.header('Set-Cookie', clearPassportSessionCookie(new URL(c.req.url).protocol === 'https:'));
		return apiMessage(c, 200, '已退出 Passport');
	}
	if (c.req.method !== 'POST') return next();
	const body = await parseBody(c), step = text(body.step) || 'email';
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
		const owner = await database.prepare(`SELECT CAST(a.user_id AS TEXT) AS user_id FROM passport_telegram_accounts a
			JOIN passport_users u ON u.user_id = a.user_id WHERE a.id = ?1 AND u.status = 'enabled'`).bind(accountId).first<{ user_id: string }>();
		if (!owner) return apiMessage(c, 409, 'Passport 用户已停用或不存在');
		const challengeId = crypto.randomUUID(), expectedNumber = randomNumber(), now = Date.now();
		await database.prepare(`UPDATE passport_login_challenges SET status = 'expired', updated_at = ?3
			WHERE bot_id = ?1 AND telegram_user_id = ?2 AND status = 'pending'`).bind(selected.bot.id, selected.account.telegram_user_id, now).run();
		await database.prepare(`INSERT INTO passport_login_challenges
			(id, user_id, bot_id, telegram_user_id, chat_id, expected_number, status, expires_at, created_at, updated_at)
			VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8, ?8)`).bind(challengeId, owner.user_id, selected.bot.id,
			selected.account.telegram_user_id, selected.account.chat_id, expectedNumber, now + 10 * 60_000, now).run();
		try {
			await sendTelegramMessage(selected.bot.bot_token, selected.account.chat_id,
				`网页登录确认：请点击网页显示的数字。若不是本人操作，请点击“这不是我的操作”。`, challengeKeyboard(challengeId, expectedNumber));
		} catch (error) {
			await database.prepare(`UPDATE passport_login_challenges SET status = 'expired', updated_at = ?2 WHERE id = ?1`).bind(challengeId, Date.now()).run();
			return apiMessage(c, 502, error instanceof Error ? error.message : 'Telegram 登录确认发送失败');
		}
		const formPage = approvalForm(challengeId, expectedNumber);
		return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues, feedback: { component: 'inline', type: 'info', message: '登录确认已发送到 Telegram' } });
	}
	if (step === 'poll') {
		const challengeId = text(body.challenge_id);
		if (!/^[0-9a-f-]{36}$/i.test(challengeId)) return apiMessage(c, 400, '登录确认编号不合法');
		const challenge = await database.prepare(`SELECT CAST(user_id AS TEXT) AS user_id, expected_number, status, expires_at
			FROM passport_login_challenges WHERE id = ?1`).bind(challengeId).first<{ user_id: string; expected_number: number; status: string; expires_at: number }>();
		if (!challenge) return apiMessage(c, 404, '登录确认不存在');
		if (challenge.expires_at <= Date.now() && challenge.status === 'pending') {
			await database.prepare(`UPDATE passport_login_challenges SET status = 'expired', updated_at = ?2 WHERE id = ?1 AND status = 'pending'`).bind(challengeId, Date.now()).run();
			return apiMessage(c, 409, '登录确认已过期，请重新开始');
		}
		if (challenge.status === 'pending') {
			const formPage = approvalForm(challengeId, challenge.expected_number);
			return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues, feedback: { component: 'inline', type: 'warning', message: '尚未收到 Telegram 批准，请确认数字后重试' } });
		}
		if (challenge.status !== 'approved') return apiMessage(c, 409, challenge.status === 'denied' ? '本次登录已被拒绝' : '登录确认已经失效');
		const sessionId = crypto.randomUUID(), now = Date.now(), maxAge = 24 * 60 * 60;
		if (!database.batch) return apiMessage(c, 500, 'Passport 数据库不支持原子登录');
		const statements: DatabaseBatchStatement[] = [
			{ query: `INSERT INTO passport_sessions (id, user_id, expires_at, created_at)
				SELECT ?1, user_id, ?3, ?4 FROM passport_login_challenges WHERE id = ?2 AND status = 'approved'`, values: [sessionId, challengeId, now + maxAge * 1000, now] },
			{ query: `UPDATE passport_login_challenges SET status = 'consumed', updated_at = ?2 WHERE id = ?1 AND status = 'approved'`, values: [challengeId, now] },
		];
		await database.batch(statements);
		const createdSession = await database.prepare(`SELECT id FROM passport_sessions WHERE id = ?1`).bind(sessionId).first();
		if (!createdSession) return apiMessage(c, 409, '登录确认已被使用');
		const secure = new URL(c.req.url).protocol === 'https:';
		c.header('Set-Cookie', createPassportSessionCookie(sessionId, secure, maxAge));
		const ssoRequestId = readNamedCookie(c.req.raw, passportSsoRequestCookieName);
		const ticket = ssoRequestId ? await issuePassportLoginTicket(database, ssoRequestId, challenge.user_id) : undefined;
		if (ssoRequestId) c.header('Set-Cookie', clearSsoRequestCookie(secure), { append: true });
		return apiMessageData(c, 200, 'Passport 登录成功', {
			user: { id: challenge.user_id },
			...(ticket ? { redirectTo: ticket.redirectUrl } : {}),
		}, { redirectAfter: 0 });
	}
	return apiMessage(c, 400, '不支持的登录步骤');
};

export default handler;
