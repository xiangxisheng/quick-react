import type { DatabaseAdapter, DatabaseBatchStatement } from '@server/database/index.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';
import { hashPassword, verifyPassword } from '@server/modules/base/auth.mjs';
import { normalizePassportEmail } from './identity.mjs';
import { getPassportSnowflakeGenerator } from './snowflake.mjs';

/** 用户名只允许小写字母开头的小写字母数字组合，长度 6-12。 */
const usernamePattern = /^[a-z][a-z0-9]{5,11}$/;
const reservedUsernames = new Set(['admin', 'root', 'system', 'support', 'official', 'passport', 'accounts', 'service', 'security']);

export const normalizeAccountUsername = (value: string) => {
	const username = value.trim();
	if (!usernamePattern.test(username)) throw new Error('用户名必须以小写字母开头，只能包含小写字母和数字，长度 6 到 12 位');
	if (reservedUsernames.has(username)) throw new Error('该用户名属于系统保留名称，请更换后重试');
	return username;
};

export const normalizeAccountNickname = (value: string) => {
	const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
	if (!normalized) throw new Error('昵称不能为空');
	return Array.from(normalized).slice(0, 12).join('');
};

/** 合法用户名：小写字母开头的小写字母数字组合，长度 6-12，且不是保留名称。 */
export const isValidAccountUsername = (value: string) => usernamePattern.test(value) && !reservedUsernames.has(value);

/** 历史导入或占位用户名（例如 passport_<user_id>）不符合规则，登录前必须改成合法用户名。 */
export const accountUsernameState = async (database: DatabaseAdapter, userId: string) => {
	const username = await loadAccountUsername(database, userId);
	if (!username) return { state: 'missing' as const, username: '' };
	if (!isValidAccountUsername(username)) return { state: 'invalid' as const, username };
	return { state: 'ready' as const, username };
};

export const loadAccountUsername = async (database: DatabaseAdapter, userId: string) => (
	await firstSql<{ username: string }>(database, sql(database).select({ table: 'passport_usernames', columns: { username: 'username' }, where: [{ column: 'user_id', value: userId }] }))
)?.username;

export const setAccountUsername = async (database: DatabaseAdapter, userId: string, rawUsername: string) => {
	const username = normalizeAccountUsername(rawUsername);
	const current = await accountUsernameState(database, userId);
	if (current.state === 'ready') throw new Error('用户名已经设置，不能修改');
	// 同上：user_id 是雪花 ID，必须按文本读取，否则用户名被占用时会抛数值溢出错误。
	const taken = await firstSql(database, sql(database).select({ table: 'passport_usernames', columns: { user_id: { column: 'user_id', cast: 'text' } }, where: [{ column: 'username', value: username }] }));
	if (taken) throw new Error('该用户名已被占用，请更换后重试');
	try {
		// 占位或历史用户名允许改写，正式用户名只能新增一次。
		if (current.state === 'invalid') await runSql(database, sql(database).update('passport_usernames', { username }, { user_id: userId }));
		else await runSql(database, sql(database).insert('passport_usernames', { user_id: userId, username, created_at: Date.now() }));
	} catch {
		throw new Error('该用户名已被占用，请更换后重试');
	}
	return username;
};

export const hasAccountPassword = async (database: DatabaseAdapter, userId: string) => Boolean(
	await firstSql(database, sql(database).select({ table: 'passport_user_credentials', columns: { id: 'id' }, where: [{ column: 'user_id', value: userId }], limit: 1 })),
);

export const updateAccountNickname = async (database: DatabaseAdapter, userId: string, rawNickname: string) => {
	const nickname = normalizeAccountNickname(rawNickname);
	await runSql(database, sql(database).update('passport_users', { nickname, updated_at: Date.now() }, { user_id: userId }));
	return nickname;
};

/** 统一的时间展示格式，避免依赖运行时的本地化能力。 */
export const utcMinutes = (timestamp: number) => `${new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export type AccountEmail = { email_id: string; email: string; verified: number; is_primary: number; created_at: number };

export const listAccountEmails = (database: DatabaseAdapter, userId: string) => allSql<AccountEmail>(database, sql(database).select({
	table: 'passport_user_emails', alias: 'ue',
	columns: { email_id: { column: 'ue.email_id', cast: 'text' }, email: 'e.email', verified: 'e.verified', is_primary: 'ue.is_primary', created_at: 'ue.created_at' },
	joins: [{ table: 'passport_emails', alias: 'e', left: 'e.id', right: 'ue.email_id' }],
	where: [{ column: 'ue.user_id', value: userId }],
	orderBy: [{ column: 'ue.is_primary', direction: 'DESC' }, { column: 'ue.created_at' }],
}));

const emailOwner = (database: DatabaseAdapter, email: string) => firstSql<{ user_id: string }>(database, sql(database).select({
	table: 'passport_emails', alias: 'e',
	columns: { user_id: { column: 'ue.user_id', cast: 'text' } },
	joins: [{ table: 'passport_user_emails', alias: 'ue', left: 'ue.email_id', right: 'e.id' }],
	where: [{ column: 'e.email', value: email }],
	limit: 1,
}));

const generateEmailCode = () => {
	const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000, values = new Uint32Array(1);
	do crypto.getRandomValues(values); while (values[0] >= limit);
	return String(values[0] % 1_000_000).padStart(6, '0');
};

export class AccountEmailRateLimitError extends Error {
	constructor(public readonly waitSeconds: number) { super(`邮件发送过于频繁，请 ${waitSeconds} 秒后重试`); }
}

/** 已登录用户添加邮箱：限流与验证码策略和外部身份注册保持一致。 */
export const issueAccountEmailOtp = async (database: DatabaseAdapter, userId: string, rawEmail: string) => {
	const email = normalizePassportEmail(rawEmail), now = Date.now();
	const owner = await emailOwner(database, email);
	if (owner) throw new Error(owner.user_id === userId ? '该邮箱已经绑定到当前账号' : '该邮箱已被其他 Accounts 用户绑定');
	const recent = await allSql<{ created_at: number }>(database, sql(database).select({ table: 'passport_user_email_otps', columns: { created_at: 'created_at' }, where: [{ column: 'user_id', value: userId }, { column: 'created_at', operator: '>', value: now - 60 * 60_000 }], orderBy: [{ column: 'created_at', direction: 'DESC' }] }));
	if (recent[0] && now - recent[0].created_at < 60_000) throw new AccountEmailRateLimitError(Math.ceil((60_000 - (now - recent[0].created_at)) / 1000));
	if (recent.length >= 10) throw new AccountEmailRateLimitError(Math.max(1, Math.ceil((recent.at(-1)!.created_at + 60 * 60_000 - now) / 1000)));
	await runSql(database, sql(database).update('passport_user_email_otps', { status: 'expired', updated_at: now }, [{ column: 'user_id', value: userId }, { column: 'status', value: 'pending' }]));
	const code = generateEmailCode(), id = crypto.randomUUID();
	await runSql(database, sql(database).insert('passport_user_email_otps', { id, user_id: userId, email, code_hash: await hashPassword(code), attempt_count: 0, status: 'pending', expires_at: now + 600_000, created_at: now, updated_at: now }));
	return { code, email, expiresAt: now + 600_000 };
};

export const pendingAccountEmailOtp = (database: DatabaseAdapter, userId: string) => firstSql<{ id: string; email: string; expires_at: number; created_at: number }>(database, sql(database).select({
	table: 'passport_user_email_otps',
	columns: { id: 'id', email: 'email', expires_at: 'expires_at', created_at: 'created_at' },
	where: [{ column: 'user_id', value: userId }, { column: 'status', value: 'pending' }, { column: 'expires_at', operator: '>', value: Date.now() }],
	orderBy: [{ column: 'created_at', direction: 'DESC' }],
	limit: 1,
}));

export const discardAccountEmailOtp = (database: DatabaseAdapter, userId: string) => runSql(database, sql(database).update('passport_user_email_otps', { status: 'expired', updated_at: Date.now() }, [{ column: 'user_id', value: userId }, { column: 'status', value: 'pending' }]));

export type AccountEmailVerification = { status: 'bound'; email: string } | { status: 'invalid' | 'expired' | 'locked' | 'none' } | { status: 'conflict'; message: string };

export const verifyAccountEmailOtp = async (database: DatabaseAdapter, workerId: unknown, userId: string, rawCode: string): Promise<AccountEmailVerification> => {
	const code = rawCode.trim();
	if (!/^\d{6}$/.test(code)) return { status: 'invalid' };
	const otp = await firstSql<{ id: string; email: string; code_hash: string; attempt_count: number; expires_at: number }>(database, sql(database).select({ table: 'passport_user_email_otps', columns: { id: 'id', email: 'email', code_hash: 'code_hash', attempt_count: 'attempt_count', expires_at: 'expires_at' }, where: [{ column: 'user_id', value: userId }, { column: 'status', value: 'pending' }], orderBy: [{ column: 'created_at', direction: 'DESC' }], limit: 1 }));
	if (!otp) return { status: 'none' };
	const now = Date.now();
	if (otp.expires_at <= now) {
		await runSql(database, sql(database).update('passport_user_email_otps', { status: 'expired', updated_at: now }, { id: otp.id }));
		return { status: 'expired' };
	}
	if (otp.attempt_count >= 5) return { status: 'locked' };
	if (!await verifyPassword(code, otp.code_hash)) {
		const attempts = otp.attempt_count + 1;
		await runSql(database, sql(database).update('passport_user_email_otps', { attempt_count: attempts, status: attempts >= 5 ? 'expired' : 'pending', updated_at: now }, { id: otp.id }));
		return { status: attempts >= 5 ? 'locked' : 'invalid' };
	}
	const owner = await emailOwner(database, otp.email);
	if (owner) {
		await runSql(database, sql(database).update('passport_user_email_otps', { status: 'used', updated_at: now }, { id: otp.id }));
		return { status: 'conflict', message: owner.user_id === userId ? '该邮箱已经绑定到当前账号' : '该邮箱已被其他 Accounts 用户绑定' };
	}
	const existing = await listAccountEmails(database, userId);
	const generator = getPassportSnowflakeGenerator(database, workerId);
	const emailId = (await generator.next()).toString();
	const statements: DatabaseBatchStatement[] = [
		sql(database).insert('passport_emails', { id: emailId, email: otp.email, verified: 1, created_at: now, updated_at: now }),
		sql(database).insert('passport_user_emails', { user_id: userId, email_id: emailId, is_primary: existing.length ? 0 : 1, created_at: now }),
		sql(database).update('passport_user_email_otps', { status: 'used', updated_at: now }, { id: otp.id }),
	];
	if (database.batch) await database.batch(statements);
	else for (const statement of statements) await runSql(database, { query: statement.query, values: statement.values ?? [] });
	return { status: 'bound', email: otp.email };
};

export const setPrimaryAccountEmail = async (database: DatabaseAdapter, userId: string, emailId: string) => {
	const emails = await listAccountEmails(database, userId);
	const target = emails.find((item) => item.email_id === emailId);
	if (!target) throw new Error('邮箱不存在或不属于当前账号');
	if (!target.verified) throw new Error('邮箱尚未验证，不能设为主邮箱');
	if (target.is_primary) return target.email;
	await runSql(database, sql(database).update('passport_user_emails', { is_primary: 0 }, { user_id: userId }));
	await runSql(database, sql(database).update('passport_user_emails', { is_primary: 1 }, { user_id: userId, email_id: emailId }));
	return target.email;
};

export const unbindAccountEmail = async (database: DatabaseAdapter, userId: string, emailId: string) => {
	const emails = await listAccountEmails(database, userId);
	const target = emails.find((item) => item.email_id === emailId);
	if (!target) throw new Error('邮箱不存在或不属于当前账号');
	if (emails.length <= 1) throw new Error('至少需要保留一个邮箱，不能解绑最后一个邮箱');
	if (target.is_primary) throw new Error('主邮箱不能解绑，请先把其它邮箱设为主邮箱');
	await runSql(database, sql(database).delete('passport_user_emails', { user_id: userId, email_id: emailId }));
	await runSql(database, sql(database).delete('passport_emails', { id: emailId }));
	return target.email;
};

export type AccountIdentity = {
	identity_key: string;
	kind: 'external' | 'telegram';
	provider_label: string;
	nickname: string;
	avatar: string;
	detail: string;
	created_at: number;
};

const externalIdentityNickname = (profile: string) => {
	try {
		const parsed = JSON.parse(profile) as Record<string, unknown>;
		return String(parsed.nickname ?? parsed.name ?? parsed.given_name ?? '').trim();
	} catch { return ''; }
};
const externalIdentityAvatar = (profile: string) => {
	try {
		const parsed = JSON.parse(profile) as Record<string, unknown>;
		return String(parsed.picture ?? parsed.headimgurl ?? parsed.avatar ?? '').trim();
	} catch { return ''; }
};

/** 账户中心的身份列表：外部身份源和 Telegram 账号；机器人信息来自 global 库。 */
export const listAccountIdentities = async (database: DatabaseAdapter, globalDatabase: DatabaseAdapter, userId: string): Promise<AccountIdentity[]> => {
	const [externals, providers, telegrams] = await Promise.all([
		allSql<{ id: string; provider: string; subject: string; profile: string; created_at: number }>(database, sql(database).select({
			table: 'passport_external_identities',
			columns: { id: { column: 'id', cast: 'text' }, provider: 'provider', subject: 'subject', profile: 'profile', created_at: 'created_at' },
			where: [{ column: 'user_id', value: userId }],
			orderBy: [{ column: 'created_at' }],
		})),
		allSql<{ id: string; display_name: string }>(database, sql(database).select({ table: 'passport_external_providers', columns: { id: 'id', display_name: 'display_name' } })),
		allSql<{ id: string; bot_id: string; telegram_user_id: string; nickname: string; created_at: number }>(database, sql(database).select({
			table: 'passport_telegram_accounts',
			columns: { id: { column: 'id', cast: 'text' }, bot_id: { column: 'bot_id', cast: 'text' }, telegram_user_id: { column: 'telegram_user_id', cast: 'text' }, nickname: 'nickname', created_at: 'created_at' },
			where: [{ column: 'user_id', value: userId }],
			orderBy: [{ column: 'created_at' }],
		})),
	]);
	const bots = telegrams.length
		? await allSql<{ id: string; bot_username: string }>(globalDatabase, sql(globalDatabase).select({ table: 'global_telegram_bots', columns: { id: { column: 'id', cast: 'text' }, bot_username: 'bot_username' } }))
		: [];
	const providerNames = new Map(providers.map((provider) => [provider.id, provider.display_name]));
	const botNames = new Map(bots.map((bot) => [bot.id, bot.bot_username]));
	return [
		...externals.map((item) => ({
			identity_key: `external:${item.id}`,
			kind: 'external' as const,
			provider_label: providerNames.get(item.provider) ?? item.provider,
			nickname: externalIdentityNickname(item.profile),
			avatar: externalIdentityAvatar(item.profile),
			// 微信的 subject 是 appid:openid，只展示后半段，避免泄露应用标识。
			detail: item.subject.includes(':') ? item.subject.slice(item.subject.indexOf(':') + 1) : item.subject,
			created_at: item.created_at,
		})),
		...telegrams.map((item) => ({
			identity_key: `telegram:${item.id}`,
			kind: 'telegram' as const,
			provider_label: 'Telegram',
			nickname: item.nickname,
			avatar: '',
			detail: `@${botNames.get(item.bot_id) ?? item.bot_id} / ${item.telegram_user_id}`,
			created_at: item.created_at,
		})),
	];
};

/** 解绑第三方身份；解绑后必须还留有可用的登录方式。 */
export const unbindAccountIdentity = async (database: DatabaseAdapter, globalDatabase: DatabaseAdapter, userId: string, identityKey: string) => {
	const identities = await listAccountIdentities(database, globalDatabase, userId);
	const target = identities.find((item) => item.identity_key === identityKey);
	if (!target) throw new Error('身份不存在或不属于当前账号');
	if (target.kind === 'telegram') throw new Error('Telegram 账号请在 Telegram 机器人里解除绑定');
	if (identities.length <= 1 && !await hasAccountPassword(database, userId)) {
		throw new Error('这是账号最后一个登录方式，请先设置密码或绑定其它身份后再解绑');
	}
	await runSql(database, sql(database).delete('passport_external_identities', { id: identityKey.slice('external:'.length), user_id: userId }));
	return target.provider_label;
};

/** 账户中心概览需要的聚合信息。 */
export const loadAccountProfile = async (database: DatabaseAdapter, userId: string) => {
	const [user, username, emails, hasPassword, identities, telegramAccounts] = await Promise.all([
		firstSql<{ nickname: string; created_at: number }>(database, sql(database).select({ table: 'passport_users', columns: { nickname: 'nickname', created_at: 'created_at' }, where: [{ column: 'user_id', value: userId }] })),
		loadAccountUsername(database, userId),
		listAccountEmails(database, userId),
		hasAccountPassword(database, userId),
		allSql<{ provider: string }>(database, sql(database).select({ table: 'passport_external_identities', columns: { provider: 'provider' }, where: [{ column: 'user_id', value: userId }] })),
		allSql<{ id: string }>(database, sql(database).select({ table: 'passport_telegram_accounts', columns: { id: { column: 'id', cast: 'text' } }, where: [{ column: 'user_id', value: userId }] })),
	]);
	return {
		userId,
		nickname: user?.nickname ?? '',
		createdAt: user?.created_at ?? 0,
		username,
		emails,
		primaryEmail: emails.find((item) => item.is_primary)?.email ?? '',
		hasPassword,
		providers: identities.map((item) => item.provider),
		telegramCount: telegramAccounts.length,
	};
};
