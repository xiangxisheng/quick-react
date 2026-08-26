import { sendDefaultCloudEmail } from '@server/cloud/email.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import {
	cancelTelegramIdentityChoice,
	confirmTelegramIdentityChoice,
	createTelegramIdentityChoice,
	expireTelegramEmailOtp,
	issueTelegramEmailOtp,
	normalizePassportEmail,
	normalizePassportNickname,
	TelegramOtpRateLimitError,
	verifyTelegramEmailOtp,
	type TelegramIdentity,
} from './identity.mjs';
import {
	answerTelegramCallback,
	deleteTelegramMessage,
	editTelegramMessage,
	sendTelegramMessage,
	type TelegramInlineKeyboard,
} from '@server/telegram/api.mjs';

export type PassportTelegramBot = { id: string; botToken: string };

type TelegramUser = { id?: number | string; first_name?: string; last_name?: string; username?: string };
type TelegramChat = { id?: number | string; type?: string };
type TelegramMessage = { message_id?: number | string; chat?: TelegramChat; from?: TelegramUser; text?: string };
type TelegramCallback = { id?: string; from?: TelegramUser; message?: TelegramMessage; data?: string };
export type PassportTelegramUpdate = { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallback };
type MenuMode = 'menu' | 'email' | 'otp';
type MenuState = { chat_id: string; message_id: string; mode: MenuMode };

const decimal = (value: unknown, positive = true) => {
	if ((typeof value !== 'number' || !Number.isSafeInteger(value)) && (typeof value !== 'string' || !/^-?\d+$/.test(value))) return undefined;
	const parsed = BigInt(String(value));
	if ((positive && parsed <= 0n) || parsed < -(1n << 63n) || parsed > (1n << 63n) - 1n) return undefined;
	return parsed.toString();
};
const keyboard = (...rows: Array<Array<{ text: string; callback_data: string }>>): TelegramInlineKeyboard => ({ inline_keyboard: rows });
const rootKeyboard = keyboard([{ text: '账户', callback_data: 'menu:accounts' }]);
const accountsKeyboard = keyboard(
	[{ text: '绑定新邮箱', callback_data: 'menu:bind_email' }],
	[{ text: '管理邮箱', callback_data: 'menu:emails' }],
	[{ text: '返回', callback_data: 'menu:back' }],
);
const backAccountsKeyboard = keyboard([{ text: '返回账户服务', callback_data: 'menu:accounts' }]);
const otpKeyboard = keyboard(
	[{ text: '重发邮件验证码', callback_data: 'email:resend' }],
	[{ text: '更改邮箱地址', callback_data: 'menu:bind_email' }],
);
const nickname = (user: TelegramUser, userId: string) => normalizePassportNickname(
	[user.first_name, user.last_name].filter((item) => typeof item === 'string' && item.trim()).join(' ') || String(user.username ?? ''),
	userId,
);
const identityFrom = (bot: PassportTelegramBot, user: TelegramUser | undefined, chat: TelegramChat | undefined): TelegramIdentity | undefined => {
	const telegramUserId = decimal(user?.id), chatId = decimal(chat?.id, false);
	if (!telegramUserId || !chatId) return undefined;
	if (chat?.type === 'private' && chatId !== telegramUserId) return undefined;
	return { botId: bot.id, telegramUserId, chatId, nickname: nickname(user ?? {}, telegramUserId) };
};

const loadMenu = (database: DatabaseAdapter, identity: TelegramIdentity) => database.prepare(`SELECT CAST(chat_id AS TEXT) AS chat_id,
	CAST(message_id AS TEXT) AS message_id, mode FROM passport_telegram_menus WHERE bot_id = ?1 AND telegram_user_id = ?2`)
	.bind(identity.botId, identity.telegramUserId).first<MenuState>();
const saveMenu = async (database: DatabaseAdapter, identity: TelegramIdentity, messageId: string, mode: MenuMode) => {
	const now = Date.now();
	const existing = await loadMenu(database, identity);
	if (existing) await database.prepare(`UPDATE passport_telegram_menus SET chat_id = ?3, message_id = ?4, mode = ?5, updated_at = ?6
		WHERE bot_id = ?1 AND telegram_user_id = ?2`).bind(identity.botId, identity.telegramUserId, identity.chatId, messageId, mode, now).run();
	else {
		try {
			await database.prepare(`INSERT INTO passport_telegram_menus
				(bot_id, telegram_user_id, chat_id, message_id, mode, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`)
				.bind(identity.botId, identity.telegramUserId, identity.chatId, messageId, mode, now).run();
		} catch {
			await database.prepare(`UPDATE passport_telegram_menus SET chat_id = ?3, message_id = ?4, mode = ?5, updated_at = ?6
				WHERE bot_id = ?1 AND telegram_user_id = ?2`).bind(identity.botId, identity.telegramUserId, identity.chatId, messageId, mode, now).run();
		}
	}
};
const editMenu = async (database: DatabaseAdapter, bot: PassportTelegramBot, identity: TelegramIdentity, messageId: string, mode: MenuMode, text: string, replyMarkup: TelegramInlineKeyboard) => {
	await editTelegramMessage(bot.botToken, String(identity.chatId), messageId, text, replyMarkup);
	await saveMenu(database, identity, messageId, mode);
};
const showRootMenu = async (database: DatabaseAdapter, bot: PassportTelegramBot, identity: TelegramIdentity) => {
	const previous = await loadMenu(database, identity);
	const sent = await sendTelegramMessage(bot.botToken, String(identity.chatId), '请选择服务', rootKeyboard);
	await saveMenu(database, identity, sent.messageId, 'menu');
	if (previous?.message_id && previous.message_id !== sent.messageId) await deleteTelegramMessage(bot.botToken, previous.chat_id, previous.message_id).catch(() => undefined);
};
const editAccounts = (database: DatabaseAdapter, bot: PassportTelegramBot, identity: TelegramIdentity, messageId: string) => editMenu(database, bot, identity, messageId, 'menu', '账户服务', accountsKeyboard);

const pendingOtp = (database: DatabaseAdapter, identity: TelegramIdentity) => database.prepare(`SELECT email FROM passport_email_otp
	WHERE bot_id = ?1 AND telegram_user_id = ?2 AND status = 'pending' ORDER BY created_at DESC, id DESC LIMIT 1`)
	.bind(identity.botId, identity.telegramUserId).first<{ email: string }>();
const latestOtp = (database: DatabaseAdapter, identity: TelegramIdentity) => database.prepare(`SELECT email FROM passport_email_otp
	WHERE bot_id = ?1 AND telegram_user_id = ?2 ORDER BY created_at DESC, id DESC LIMIT 1`)
	.bind(identity.botId, identity.telegramUserId).first<{ email: string }>();
const issueAndSendOtp = async (database: DatabaseAdapter, globalDatabase: DatabaseAdapter, identity: TelegramIdentity, email: string) => {
	const issued = await issueTelegramEmailOtp(database, identity, email);
	try {
		await sendDefaultCloudEmail(globalDatabase, 'passport', 'email_verification', issued.email, {
			code: issued.code,
			email: issued.email,
			nickname: identity.nickname,
			expires_minutes: '10',
			site_name: 'Passport',
		});
	} catch (error) {
		await expireTelegramEmailOtp(database, identity);
		throw error;
	}
	return issued;
};
const promptOtp = (database: DatabaseAdapter, bot: PassportTelegramBot, identity: TelegramIdentity, messageId: string, email: string, prefix = '验证码已发送') => editMenu(
	database, bot, identity, messageId, 'otp', `${prefix}\n请输入 ${email} 收到的 6 位数字验证码`, otpKeyboard,
);

const listEmails = async (database: DatabaseAdapter, bot: PassportTelegramBot, identity: TelegramIdentity, messageId: string) => {
	const rows = await database.prepare(`SELECT CAST(e.id AS TEXT) AS id, e.email, e.verified FROM passport_telegram_accounts a
		JOIN passport_user_emails ue ON ue.user_id = a.user_id JOIN passport_emails e ON e.id = ue.email_id
		WHERE a.bot_id = ?1 AND a.telegram_user_id = ?2 ORDER BY ue.is_primary DESC, e.email`)
		.bind(identity.botId, identity.telegramUserId).all<{ id: string; email: string; verified: number }>();
	const rowsKeyboard = rows.results.map((item) => [{ text: `${item.email} (${item.verified ? '已验证' : '未验证'})`, callback_data: `email:open:${item.id}` }]);
	rowsKeyboard.push([{ text: '返回账户服务', callback_data: 'menu:accounts' }]);
	await editMenu(database, bot, identity, messageId, 'menu', rows.results.length ? '请选择邮箱' : '暂无已绑定邮箱', { inline_keyboard: rowsKeyboard });
};
const openEmail = async (database: DatabaseAdapter, bot: PassportTelegramBot, identity: TelegramIdentity, messageId: string, emailId: string) => {
	const row = await database.prepare(`SELECT e.email, e.verified FROM passport_telegram_accounts a
		JOIN passport_user_emails ue ON ue.user_id = a.user_id JOIN passport_emails e ON e.id = ue.email_id
		WHERE a.bot_id = ?1 AND a.telegram_user_id = ?2 AND e.id = ?3`).bind(identity.botId, identity.telegramUserId, emailId).first<{ email: string; verified: number }>();
	if (!row) return editMenu(database, bot, identity, messageId, 'menu', '邮箱不存在或不属于当前账户', backAccountsKeyboard);
	return editMenu(database, bot, identity, messageId, 'menu', `${row.verified ? '邮箱已验证' : '邮箱未验证'}：${row.email}`, keyboard([{ text: '返回邮箱列表', callback_data: 'menu:emails' }]));
};

const handleEmailInput = async (database: DatabaseAdapter, globalDatabase: DatabaseAdapter, bot: PassportTelegramBot, identity: TelegramIdentity, menu: MenuState, text: string) => {
	let email: string;
	try { email = normalizePassportEmail(text); }
	catch { return editMenu(database, bot, identity, menu.message_id, 'email', '邮箱格式不正确，请重新输入', backAccountsKeyboard); }
	try {
		await issueAndSendOtp(database, globalDatabase, identity, email);
		return promptOtp(database, bot, identity, menu.message_id, email);
	} catch (error) {
		if (error instanceof TelegramOtpRateLimitError) return editMenu(database, bot, identity, menu.message_id, 'email', `发送太频繁，请 ${error.waitSeconds} 秒后重试`, backAccountsKeyboard);
		return editMenu(database, bot, identity, menu.message_id, 'email', '验证码邮件发送失败，请稍后重试', backAccountsKeyboard);
	}
};
const handleOtpInput = async (database: DatabaseAdapter, configuredWorkerId: unknown, bot: PassportTelegramBot, identity: TelegramIdentity, menu: MenuState, code: string) => {
	const pending = await pendingOtp(database, identity);
	if (!pending) return editMenu(database, bot, identity, menu.message_id, 'email', '没有待验证的邮箱，请重新输入邮箱地址', backAccountsKeyboard);
	const result = await verifyTelegramEmailOtp(database, configuredWorkerId, identity, code);
	if (result.status === 'created' || result.status === 'linked' || result.status === 'existing') return editMenu(
		database, bot, identity, menu.message_id, 'menu', `验证成功，用户 ID：${result.userId}`, accountsKeyboard,
	);
	if (result.status === 'conflict' && !result.telegramUserId && result.emailUserId) {
		const choice = await createTelegramIdentityChoice(database, identity, result.emailUserId, pending.email);
		return editMenu(database, bot, identity, menu.message_id, 'menu', `该邮箱已属于用户 ${result.emailUserId}，请选择是否将当前 Telegram 账号绑定到该用户`, keyboard(
			[{ text: '确认绑定现有用户', callback_data: `identity:link:${choice.id}` }],
			[{ text: '取消', callback_data: `identity:cancel:${choice.id}` }],
		));
	}
	if (result.status === 'conflict') return editMenu(database, bot, identity, menu.message_id, 'menu', '当前 Telegram 账号与邮箱属于不同用户，未执行自动合并', accountsKeyboard);
	if (result.status === 'disabled') return editMenu(database, bot, identity, menu.message_id, 'menu', '关联用户已停用，无法继续绑定', accountsKeyboard);
	const prefix = result.status === 'expired' ? '验证码已过期' : result.status === 'locked' ? '尝试次数过多，请重新发送验证码' : '验证码不正确';
	return promptOtp(database, bot, identity, menu.message_id, pending.email, prefix);
};

const handleMessage = async (database: DatabaseAdapter, globalDatabase: DatabaseAdapter, configuredWorkerId: unknown, bot: PassportTelegramBot, message: TelegramMessage) => {
	if (message.chat?.type !== 'private') return;
	const identity = identityFrom(bot, message.from, message.chat);
	if (!identity) return;
	const text = typeof message.text === 'string' ? message.text.trim() : '';
	if (/^\/(start|menu)(@\w+)?$/i.test(text)) return showRootMenu(database, bot, identity);
	const menu = await loadMenu(database, identity);
	if (!menu) return showRootMenu(database, bot, identity);
	if (text && menu.mode === 'email') await handleEmailInput(database, globalDatabase, bot, identity, menu, text);
	else if (text && menu.mode === 'otp') await handleOtpInput(database, configuredWorkerId, bot, identity, menu, text);
	else if (text) await showRootMenu(database, bot, identity);
	if (text && message.message_id !== undefined) {
		const messageId = decimal(message.message_id);
		if (messageId) await deleteTelegramMessage(bot.botToken, String(identity.chatId), messageId).catch(() => undefined);
	}
};

const handleCallback = async (database: DatabaseAdapter, globalDatabase: DatabaseAdapter, configuredWorkerId: unknown, bot: PassportTelegramBot, callback: TelegramCallback) => {
	const callbackId = typeof callback.id === 'string' ? callback.id : '';
	if (callbackId) await answerTelegramCallback(bot.botToken, callbackId).catch(() => undefined);
	if (callback.message?.chat?.type !== 'private') return;
	const identity = identityFrom(bot, callback.from, callback.message.chat), messageId = decimal(callback.message.message_id);
	if (!identity || !messageId) return;
	const data = typeof callback.data === 'string' ? callback.data : '';
	if (data === 'menu:accounts') return editAccounts(database, bot, identity, messageId);
	if (data === 'menu:back') return editMenu(database, bot, identity, messageId, 'menu', '请选择服务', rootKeyboard);
	if (data === 'menu:bind_email') return editMenu(database, bot, identity, messageId, 'email', '请输入要绑定的邮箱地址', backAccountsKeyboard);
	if (data === 'menu:emails') return listEmails(database, bot, identity, messageId);
	if (data.startsWith('email:open:') && decimal(data.slice('email:open:'.length))) return openEmail(database, bot, identity, messageId, data.slice('email:open:'.length));
	if (data === 'email:verify') {
		const pending = await pendingOtp(database, identity);
		return pending ? promptOtp(database, bot, identity, messageId, pending.email, '请输入验证码')
			: editMenu(database, bot, identity, messageId, 'email', '没有待验证的邮箱，请先输入邮箱地址', backAccountsKeyboard);
	}
	if (data === 'email:resend') {
		const pending = await latestOtp(database, identity);
		if (!pending) return editMenu(database, bot, identity, messageId, 'email', '没有待验证的邮箱，请先输入邮箱地址', backAccountsKeyboard);
		try {
			await issueAndSendOtp(database, globalDatabase, identity, pending.email);
			return promptOtp(database, bot, identity, messageId, pending.email);
		} catch (error) {
			const text = error instanceof TelegramOtpRateLimitError ? `发送太频繁，请 ${error.waitSeconds} 秒后重试` : '验证码邮件发送失败，请稍后重试';
			return promptOtp(database, bot, identity, messageId, pending.email, text);
		}
	}
	if (data.startsWith('identity:link:')) {
		const choiceId = data.slice('identity:link:'.length);
		if (!decimal(choiceId)) return;
		const result = await confirmTelegramIdentityChoice(database, configuredWorkerId, identity, choiceId);
		return editMenu(database, bot, identity, messageId, 'menu', result.status === 'linked' || result.status === 'existing'
			? `Telegram 账号已绑定到用户 ${result.userId}` : '账户选择已失效或关联状态已变化，未执行绑定', accountsKeyboard);
	}
	if (data.startsWith('identity:cancel:')) {
		const choiceId = data.slice('identity:cancel:'.length);
		if (!decimal(choiceId)) return;
		await cancelTelegramIdentityChoice(database, identity, choiceId);
		return editMenu(database, bot, identity, messageId, 'menu', '已取消账户绑定', accountsKeyboard);
	}
};

export const handlePassportTelegramUpdate = async (
	database: DatabaseAdapter,
	globalDatabase: DatabaseAdapter,
	configuredWorkerId: unknown,
	bot: PassportTelegramBot,
	update: PassportTelegramUpdate,
) => {
	if (update.callback_query) await handleCallback(database, globalDatabase, configuredWorkerId, bot, update.callback_query);
	else if (update.message) await handleMessage(database, globalDatabase, configuredWorkerId, bot, update.message);
};
