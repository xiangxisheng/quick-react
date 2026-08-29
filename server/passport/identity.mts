import { createStoredPassword, hashPassword, verifyPassword, verifyStoredPassword } from '@server/auth.mjs';
import type { DatabaseAdapter, DatabaseBatchStatement } from '@server/database/index.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';
import { getPassportSnowflakeGenerator } from './snowflake.mjs';
import { assertPassword } from '@server/auth/password-policy.mjs';

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

export class TelegramOtpRateLimitError extends Error {
	constructor(public readonly waitSeconds: number) {
		super(`请 ${waitSeconds} 秒后重试`);
	}
}

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
	const recent = await allSql<{ created_at: number }>(database, sql(database).select({ table: 'passport_email_otp', columns: { created_at: 'created_at' }, where: [{ column: 'bot_id', value: botId }, { column: 'telegram_user_id', value: telegramUserId }, { column: 'created_at', operator: '>=', value: now - 60 * 60_000 }], orderBy: [{ column: 'created_at' }] }));
	const firstCreatedAt = recent[0]?.created_at, lastCreatedAt = recent.at(-1)?.created_at;
	if (lastCreatedAt && now - lastCreatedAt < 60_000) throw new TelegramOtpRateLimitError(Math.ceil((60_000 - (now - lastCreatedAt)) / 1000));
	if (recent.length >= 10) throw new TelegramOtpRateLimitError(Math.max(1, Math.ceil((Number(firstCreatedAt ?? now) + 60 * 60_000 - now) / 1000)));
	await runSql(database, sql(database).update('passport_email_otp', { status: 'expired' }, [{ column: 'bot_id', value: botId }, { column: 'telegram_user_id', value: telegramUserId }, { column: 'status', value: 'pending' }]));
	await runSql(database, sql(database).insert('passport_email_otp', { bot_id: botId, telegram_user_id: telegramUserId, chat_id: chatId, email, code_hash: await hashPassword(code), attempt_count: 0, status: 'pending', expires_at: now + lifetimeMs, created_at: now }));
	return { code, email, expiresAt: now + lifetimeMs };
};

export const expireTelegramEmailOtp = async (database: DatabaseAdapter, identity: TelegramIdentity) => {
	const botId = decimalId(identity.botId, true), telegramUserId = decimalId(identity.telegramUserId, true);
	await runSql(database, sql(database).update('passport_email_otp', { status: 'expired' }, [{ column: 'bot_id', value: botId }, { column: 'telegram_user_id', value: telegramUserId }, { column: 'status', value: 'pending' }]));
};

type AccountOwner = { user_id: string; status: string };

const telegramOwner = (database: DatabaseAdapter, botId: string, telegramUserId: string) => firstSql<AccountOwner>(database, sql(database).select({ table: 'passport_telegram_accounts', alias: 'a', columns: { user_id: { column: 'a.user_id', cast: 'text' }, status: 'u.status' }, joins: [{ table: 'passport_users', alias: 'u', left: 'u.user_id', right: 'a.user_id' }], where: [{ column: 'a.bot_id', value: botId }, { column: 'a.telegram_user_id', value: telegramUserId }] }));

const emailOwner = (database: DatabaseAdapter, email: string) => firstSql<AccountOwner>(database, sql(database).select({ table: 'passport_emails', alias: 'e', columns: { user_id: { column: 'ue.user_id', cast: 'text' }, status: 'u.status' }, joins: [{ table: 'passport_user_emails', alias: 'ue', left: 'ue.email_id', right: 'e.id' }, { table: 'passport_users', alias: 'u', left: 'u.user_id', right: 'ue.user_id' }], where: [{ column: 'e.email', value: email }] }));

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
	const otp = await firstSql<{
		id: number; email: string; code_hash: string; attempt_count: number; expires_at: number;
	}>(database, sql(database).select({ table: 'passport_email_otp', columns: { id: 'id', email: 'email', code_hash: 'code_hash', attempt_count: 'attempt_count', expires_at: 'expires_at' }, where: [{ column: 'bot_id', value: botId }, { column: 'telegram_user_id', value: telegramUserId }, { column: 'status', value: 'pending' }], orderBy: [{ column: 'created_at', direction: 'DESC' }, { column: 'id', direction: 'DESC' }], limit: 1 }));
	if (!otp) return { status: 'invalid' };
	if (otp.expires_at <= Date.now()) {
		await runSql(database, sql(database).update('passport_email_otp', { status: 'expired' }, { id: otp.id, status: 'pending' }));
		return { status: 'expired' };
	}
	if (otp.attempt_count >= 5) {
		await runSql(database, sql(database).update('passport_email_otp', { status: 'expired' }, { id: otp.id, status: 'pending' }));
		return { status: 'locked' };
	}
	if (!await verifyPassword(code, otp.code_hash)) {
		const nextAttempts = otp.attempt_count + 1;
		await runSql(database, sql(database).update('passport_email_otp', { attempt_count: nextAttempts, status: nextAttempts >= 5 ? 'expired' : 'pending' }, { id: otp.id, status: 'pending' }));
		return { status: nextAttempts >= 5 ? 'locked' : 'invalid' };
	}

	const [external, email] = await Promise.all([
		telegramOwner(database, botId, telegramUserId),
		emailOwner(database, otp.email),
	]);
	if (external?.status === 'disabled') return { status: 'disabled', userId: external.user_id };
	if (email?.status === 'disabled') return { status: 'disabled', userId: email.user_id };
	if (external && email && external.user_id !== email.user_id) {
		await runSql(database, sql(database).update('passport_email_otp', { status: 'used' }, { id: otp.id, status: 'pending' }));
		return { status: 'conflict', telegramUserId: external.user_id, emailUserId: email.user_id };
	}
	if (!external && email) {
		await runSql(database, sql(database).update('passport_email_otp', { status: 'used' }, { id: otp.id, status: 'pending' }));
		return { status: 'conflict', emailUserId: email.user_id };
	}

	const now = Date.now();
	const nickname = normalizePassportNickname(identity.nickname, telegramUserId);
	const generator = getPassportSnowflakeGenerator(database, configuredWorkerId);
	const builder = sql(database);
	const statements: DatabaseBatchStatement[] = [];
	let userId: string;
	let resultStatus: 'created' | 'linked' | 'existing';
	if (external) {
		userId = external.user_id;
		resultStatus = email ? 'existing' : 'linked';
		statements.push(builder.update('passport_telegram_accounts', { chat_id: chatId, nickname, updated_at: now }, { bot_id: botId, telegram_user_id: telegramUserId }));
	} else {
		userId = (await generator.next()).toString();
		const accountId = (await generator.next()).toString();
		resultStatus = 'created';
		statements.push(
			builder.insert('passport_users', { user_id: userId, nickname, status: 'enabled', created_at: now, updated_at: now }),
			builder.insert('passport_telegram_accounts', { id: accountId, user_id: userId, bot_id: botId, telegram_user_id: telegramUserId, chat_id: chatId, nickname, created_at: now, updated_at: now }),
		);
	}
	if (!email) {
		const emailId = (await generator.next()).toString();
		const hasUserEmail = Boolean(await firstSql(database, builder.select({ table: 'passport_user_emails', columns: { email_id: { column: 'email_id', cast: 'text' } }, where: [{ column: 'user_id', value: userId }], limit: 1 })));
		statements.push(
			builder.insert('passport_emails', { id: emailId, email: otp.email, verified: 1, created_at: now, updated_at: now }),
			builder.insert('passport_user_emails', { user_id: userId, email_id: emailId, is_primary: hasUserEmail ? 0 : 1, created_at: now }),
		);
	}
	statements.push(builder.update('passport_email_otp', { status: 'used' }, { id: otp.id, status: 'pending' }));
	if (!database.batch) throw new Error('Passport database does not support atomic batch writes');
	await database.batch(statements);
	return { status: resultStatus, userId };
};

export const createTelegramIdentityChoice = async (
	database: DatabaseAdapter,
	identity: TelegramIdentity,
	targetUserIdValue: string | number | bigint,
	rawEmail: string,
	lifetimeMs = 10 * 60_000,
) => {
	const botId = decimalId(identity.botId, true), telegramUserId = decimalId(identity.telegramUserId, true), chatId = decimalId(identity.chatId, false);
	const targetUserId = decimalId(targetUserIdValue, true), email = normalizePassportEmail(rawEmail), now = Date.now();
	const owner = await emailOwner(database, email);
	if (!owner || owner.user_id !== targetUserId || owner.status !== 'enabled') throw new Error('目标账户或邮箱状态已变化');
	await runSql(database, sql(database).update('passport_telegram_identity_choices', { status: 'cancelled', updated_at: now }, { bot_id: botId, telegram_user_id: telegramUserId, status: 'pending' }));
	await runSql(database, sql(database).insert('passport_telegram_identity_choices', { bot_id: botId, telegram_user_id: telegramUserId, chat_id: chatId, target_user_id: targetUserId, email, status: 'pending', expires_at: now + lifetimeMs, created_at: now, updated_at: now }));
	const choice = await firstSql<{ id: number }>(database, sql(database).select({ table: 'passport_telegram_identity_choices', columns: { id: 'id' }, where: [{ column: 'bot_id', value: botId }, { column: 'telegram_user_id', value: telegramUserId }, { column: 'status', value: 'pending' }], orderBy: [{ column: 'created_at', direction: 'DESC' }, { column: 'id', direction: 'DESC' }], limit: 1 }));
	if (!choice) throw new Error('账户选择创建后无法读取');
	return { id: String(choice.id), targetUserId, email, expiresAt: now + lifetimeMs };
};

export const confirmTelegramIdentityChoice = async (
	database: DatabaseAdapter,
	configuredWorkerId: unknown,
	identity: TelegramIdentity,
	choiceIdValue: string | number | bigint,
) => {
	const botId = decimalId(identity.botId, true), telegramUserId = decimalId(identity.telegramUserId, true), chatId = decimalId(identity.chatId, false);
	const choiceId = decimalId(choiceIdValue, true);
	const choice = await firstSql<{ target_user_id: string; email: string; expires_at: number; status: string }>(database, sql(database).select({ table: 'passport_telegram_identity_choices', alias: 'c', columns: { target_user_id: { column: 'c.target_user_id', cast: 'text' }, email: 'c.email', expires_at: 'c.expires_at', status: 'u.status' }, joins: [{ table: 'passport_users', alias: 'u', left: 'u.user_id', right: 'c.target_user_id' }], where: [{ column: 'c.id', value: choiceId }, { column: 'c.bot_id', value: botId }, { column: 'c.telegram_user_id', value: telegramUserId }, { column: 'c.status', value: 'pending' }] }));
	if (!choice) return { status: 'invalid' as const };
	if (choice.expires_at <= Date.now()) {
		await runSql(database, sql(database).update('passport_telegram_identity_choices', { status: 'expired', updated_at: Date.now() }, { id: choiceId, status: 'pending' }));
		return { status: 'expired' as const };
	}
	if (choice.status !== 'enabled') return { status: 'disabled' as const };
	const [external, owner] = await Promise.all([telegramOwner(database, botId, telegramUserId), emailOwner(database, choice.email)]);
	if (!owner || owner.user_id !== choice.target_user_id) return { status: 'conflict' as const };
	if (external) {
		if (external.user_id !== choice.target_user_id) return { status: 'conflict' as const };
		await runSql(database, sql(database).update('passport_telegram_identity_choices', { status: 'confirmed', updated_at: Date.now() }, { id: choiceId, status: 'pending' }));
		return { status: 'existing' as const, userId: external.user_id };
	}
	const now = Date.now(), accountId = (await getPassportSnowflakeGenerator(database, configuredWorkerId).next()).toString();
	if (!database.batch) throw new Error('Passport database does not support atomic batch writes');
	const builder = sql(database);
	await database.batch([
		builder.insert('passport_telegram_accounts', { id: accountId, user_id: choice.target_user_id, bot_id: botId, telegram_user_id: telegramUserId, chat_id: chatId, nickname: normalizePassportNickname(identity.nickname, telegramUserId), created_at: now, updated_at: now }),
		builder.update('passport_telegram_identity_choices', { status: 'confirmed', updated_at: now }, { id: choiceId, status: 'pending' }),
	]);
	return { status: 'linked' as const, userId: choice.target_user_id };
};

export const cancelTelegramIdentityChoice = async (database: DatabaseAdapter, identity: TelegramIdentity, choiceIdValue: string | number | bigint) => {
	const botId = decimalId(identity.botId, true), telegramUserId = decimalId(identity.telegramUserId, true), choiceId = decimalId(choiceIdValue, true);
	await runSql(database, sql(database).update('passport_telegram_identity_choices', { status: 'cancelled', updated_at: Date.now() }, { id: choiceId, bot_id: botId, telegram_user_id: telegramUserId, status: 'pending' }));
};

export const setPassportPassword = async (database: DatabaseAdapter, userIdValue: string | number | bigint, password: string) => {
	const userId = decimalId(userIdValue, true);
	assertPassword(password);
	const user = await firstSql(database, sql(database).select({ table: 'passport_users', columns: { user_id: { column: 'user_id', cast: 'text' } }, where: [{ column: 'user_id', value: userId }, { column: 'status', value: 'enabled' }] }));
	if (!user) throw new Error('用户不存在或已停用');
	await runSql(database, sql(database).insert('passport_user_credentials', { user_id: userId, password: await createStoredPassword(password), created_at: Date.now() }));
};

export const verifyPassportPasswordHistory = async (database: DatabaseAdapter, userIdValue: string | number | bigint, password: string) => {
	const userId = decimalId(userIdValue, true);
	const credentials = await allSql<{ password: string; created_at: number }>(database, sql(database).select({ table: 'passport_user_credentials', columns: { password: 'password', created_at: 'created_at' }, where: [{ column: 'user_id', value: userId }], orderBy: [{ column: 'created_at', direction: 'DESC' }, { column: 'id', direction: 'DESC' }] }));
	for (let index = 0; index < credentials.length; index += 1) {
		if (!await verifyStoredPassword(password, credentials[index].password)) continue;
		return index === 0
			? { status: 'current' as const, createdAt: credentials[index].created_at }
			: { status: 'old' as const, changedAt: credentials[0].created_at };
	}
	return { status: 'invalid' as const };
};
