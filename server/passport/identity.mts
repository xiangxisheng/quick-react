import { createStoredPassword, hashPassword, verifyPassword, verifyStoredPassword } from '@server/auth.mjs';
import type { DatabaseAdapter, DatabaseBatchStatement } from '@server/database/index.mjs';
import { getPassportSnowflakeGenerator } from './snowflake.mjs';

const signed64Min = -(1n << 63n);
const signed64Max = (1n << 63n) - 1n;
const emailPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

const decimalId = (value: string | number | bigint, positive: boolean) => {
	const text = String(value).trim();
	if (!/^-?\d+$/.test(text)) throw new Error('Invalid 64-bit identity value');
	const parsed = BigInt(text);
	if (parsed < signed64Min || parsed > signed64Max || (positive && parsed <= 0n)) throw new Error('Invalid 64-bit identity value');
	return parsed.toString();
};

export const normalizePassportEmail = (value: string) => {
	const email = value.trim().toLowerCase();
	if (email.length > 254 || !emailPattern.test(email)) throw new Error('邮箱地址格式不正确');
	return email;
};

export const normalizePassportNickname = (value: string, telegramUserId: string | number | bigint) => {
	const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
	const fallback = `TG${decimalId(telegramUserId, true).slice(-10)}`;
	return Array.from(normalized || fallback).slice(0, 12).join('');
};

const generateOtpCode = () => {
	const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
	const values = new Uint32Array(1);
	do crypto.getRandomValues(values); while (values[0] >= limit);
	return String(values[0] % 1_000_000).padStart(6, '0');
};

export type TelegramIdentity = {
	botId: string | number | bigint;
	telegramUserId: string | number | bigint;
	chatId: string | number | bigint;
	nickname: string;
};

export const issueTelegramEmailOtp = async (database: DatabaseAdapter, identity: TelegramIdentity, rawEmail: string, lifetimeMs = 10 * 60_000) => {
	const botId = decimalId(identity.botId, true);
	const telegramUserId = decimalId(identity.telegramUserId, true);
	const chatId = decimalId(identity.chatId, false);
	const email = normalizePassportEmail(rawEmail);
	const code = generateOtpCode();
	const now = Date.now();
	await database.prepare(`UPDATE passport_email_otp SET status = 'expired'
		WHERE bot_id = ?1 AND telegram_user_id = ?2 AND status = 'pending'`).bind(botId, telegramUserId).run();
	await database.prepare(`INSERT INTO passport_email_otp
		(bot_id, telegram_user_id, chat_id, email, code_hash, attempt_count, status, expires_at, created_at)
		VALUES (?1, ?2, ?3, ?4, ?5, 0, 'pending', ?6, ?7)`)
		.bind(botId, telegramUserId, chatId, email, await hashPassword(code), now + lifetimeMs, now).run();
	return { code, email, expiresAt: now + lifetimeMs };
};

type AccountOwner = { user_id: string; status: string };

const telegramOwner = (database: DatabaseAdapter, botId: string, telegramUserId: string) => database.prepare(`SELECT
	CAST(a.user_id AS TEXT) AS user_id, u.status FROM passport_telegram_accounts a
	JOIN passport_users u ON u.user_id = a.user_id
	WHERE a.bot_id = ?1 AND a.telegram_user_id = ?2`).bind(botId, telegramUserId).first<AccountOwner>();

const emailOwner = (database: DatabaseAdapter, email: string) => database.prepare(`SELECT
	CAST(ue.user_id AS TEXT) AS user_id, u.status FROM passport_emails e
	JOIN passport_user_emails ue ON ue.email_id = e.id
	JOIN passport_users u ON u.user_id = ue.user_id
	WHERE e.email = ?1`).bind(email).first<AccountOwner>();

export type TelegramOtpVerification =
	| { status: 'created' | 'linked' | 'existing'; userId: string }
	| { status: 'conflict'; telegramUserId?: string; emailUserId?: string }
	| { status: 'disabled'; userId: string }
	| { status: 'invalid' | 'expired' | 'locked' };

export const verifyTelegramEmailOtp = async (
	database: DatabaseAdapter,
	configuredWorkerId: unknown,
	identity: TelegramIdentity,
	rawCode: string,
): Promise<TelegramOtpVerification> => {
	const botId = decimalId(identity.botId, true);
	const telegramUserId = decimalId(identity.telegramUserId, true);
	const chatId = decimalId(identity.chatId, false);
	const code = rawCode.trim();
	if (!/^\d{6}$/.test(code)) return { status: 'invalid' };
	const otp = await database.prepare(`SELECT id, email, code_hash, attempt_count, expires_at
		FROM passport_email_otp WHERE bot_id = ?1 AND telegram_user_id = ?2 AND status = 'pending'
		ORDER BY created_at DESC, id DESC LIMIT 1`).bind(botId, telegramUserId).first<{
		id: number; email: string; code_hash: string; attempt_count: number; expires_at: number;
	}>();
	if (!otp) return { status: 'invalid' };
	if (otp.expires_at <= Date.now()) {
		await database.prepare("UPDATE passport_email_otp SET status = 'expired' WHERE id = ?1 AND status = 'pending'").bind(otp.id).run();
		return { status: 'expired' };
	}
	if (otp.attempt_count >= 5) {
		await database.prepare("UPDATE passport_email_otp SET status = 'expired' WHERE id = ?1 AND status = 'pending'").bind(otp.id).run();
		return { status: 'locked' };
	}
	if (!await verifyPassword(code, otp.code_hash)) {
		const nextAttempts = otp.attempt_count + 1;
		await database.prepare(`UPDATE passport_email_otp SET attempt_count = ?2,
			status = CASE WHEN ?2 >= 5 THEN 'expired' ELSE status END WHERE id = ?1 AND status = 'pending'`)
			.bind(otp.id, nextAttempts).run();
		return { status: nextAttempts >= 5 ? 'locked' : 'invalid' };
	}

	const [external, email] = await Promise.all([
		telegramOwner(database, botId, telegramUserId),
		emailOwner(database, otp.email),
	]);
	if (external?.status === 'disabled') return { status: 'disabled', userId: external.user_id };
	if (email?.status === 'disabled') return { status: 'disabled', userId: email.user_id };
	if (external && email && external.user_id !== email.user_id) {
		await database.prepare("UPDATE passport_email_otp SET status = 'used' WHERE id = ?1 AND status = 'pending'").bind(otp.id).run();
		return { status: 'conflict', telegramUserId: external.user_id, emailUserId: email.user_id };
	}
	if (!external && email) {
		await database.prepare("UPDATE passport_email_otp SET status = 'used' WHERE id = ?1 AND status = 'pending'").bind(otp.id).run();
		return { status: 'conflict', emailUserId: email.user_id };
	}

	const now = Date.now();
	const nickname = normalizePassportNickname(identity.nickname, telegramUserId);
	const generator = getPassportSnowflakeGenerator(database, configuredWorkerId);
	const statements: DatabaseBatchStatement[] = [];
	let userId: string;
	let resultStatus: 'created' | 'linked' | 'existing';
	if (external) {
		userId = external.user_id;
		resultStatus = email ? 'existing' : 'linked';
		statements.push({
			query: `UPDATE passport_telegram_accounts SET chat_id = ?3, nickname = ?4, updated_at = ?5
				WHERE bot_id = ?1 AND telegram_user_id = ?2`,
			values: [botId, telegramUserId, chatId, nickname, now],
		});
	} else {
		userId = (await generator.next()).toString();
		const accountId = (await generator.next()).toString();
		resultStatus = 'created';
		statements.push(
			{ query: `INSERT INTO passport_users (user_id, nickname, status, created_at, updated_at)
				VALUES (?1, ?2, 'enabled', ?3, ?3)`, values: [userId, nickname, now] },
			{ query: `INSERT INTO passport_telegram_accounts
				(id, user_id, bot_id, telegram_user_id, chat_id, nickname, created_at, updated_at)
				VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`, values: [accountId, userId, botId, telegramUserId, chatId, nickname, now] },
		);
	}
	if (!email) {
		const emailId = (await generator.next()).toString();
		statements.push(
			{ query: `INSERT INTO passport_emails (id, email, verified, created_at, updated_at)
				VALUES (?1, ?2, 1, ?3, ?3)`, values: [emailId, otp.email, now] },
			{ query: `INSERT INTO passport_user_emails (user_id, email_id, is_primary, created_at)
				VALUES (?1, ?2, CASE WHEN EXISTS (SELECT 1 FROM passport_user_emails WHERE user_id = ?1) THEN 0 ELSE 1 END, ?3)`, values: [userId, emailId, now] },
		);
	}
	statements.push({ query: "UPDATE passport_email_otp SET status = 'used' WHERE id = ?1 AND status = 'pending'", values: [otp.id] });
	if (!database.batch) throw new Error('Passport database does not support atomic batch writes');
	await database.batch(statements);
	return { status: resultStatus, userId };
};

export const setPassportPassword = async (database: DatabaseAdapter, userIdValue: string | number | bigint, password: string) => {
	const userId = decimalId(userIdValue, true);
	if (password.length < 8) throw new Error('密码至少需要 8 个字符');
	await database.prepare(`INSERT INTO passport_user_credentials (user_id, password, created_at)
		SELECT user_id, ?2, ?3 FROM passport_users WHERE user_id = ?1 AND status = 'enabled'`)
		.bind(userId, await createStoredPassword(password), Date.now()).run();
};

export const verifyPassportPasswordHistory = async (database: DatabaseAdapter, userIdValue: string | number | bigint, password: string) => {
	const userId = decimalId(userIdValue, true);
	const credentials = await database.prepare(`SELECT password, created_at FROM passport_user_credentials
		WHERE user_id = ?1 ORDER BY created_at DESC, id DESC`).bind(userId).all<{ password: string; created_at: number }>();
	for (let index = 0; index < credentials.results.length; index += 1) {
		if (!await verifyStoredPassword(password, credentials.results[index].password)) continue;
		return index === 0
			? { status: 'current' as const, createdAt: credentials.results[index].created_at }
			: { status: 'old' as const, changedAt: credentials.results[0].created_at };
	}
	return { status: 'invalid' as const };
};
