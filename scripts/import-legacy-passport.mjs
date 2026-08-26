import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const signed64Max = (1n << 63n) - 1n;
const defaultSource = '/opt/firadio/php-telegram-iam/couchdb-backup-iam-20260826-005734.json';
const defaultDatabase = resolve(import.meta.dirname, '../database/default.sqlite');
const emailPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

const fail = (message) => { throw new Error(`Legacy Passport import: ${message}`); };

const decimal = (value, label, positive = true) => {
	const text = String(value ?? '').trim();
	if (!/^-?\d+$/.test(text)) fail(`${label} is not a decimal integer`);
	const parsed = BigInt(text);
	if (parsed < -signed64Max - 1n || parsed > signed64Max || (positive && parsed <= 0n)) fail(`${label} is outside signed BIGINT range`);
	return parsed.toString();
};

const timestamp = (value, label) => {
	let parsed;
	if (typeof value === 'number' && Number.isFinite(value)) parsed = value < 1_000_000_000_000 ? value * 1000 : value;
	else if (typeof value === 'string' && value.trim()) parsed = Date.parse(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) fail(`${label} is not a valid timestamp`);
	return parsed;
};

const email = (value, label) => {
	const normalized = String(value ?? '').trim().toLowerCase();
	if (!normalized || normalized.length > 254 || !emailPattern.test(normalized)) fail(`${label} is not a valid email`);
	return normalized;
};

const nickname = (value, telegramUserId) => {
	const normalized = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
	const fallback = `TG${telegramUserId.slice(-10)}`;
	return Array.from(normalized || fallback).slice(0, 12).join('');
};

const relationKey = (...values) => values.join('\u0000');
const sortIds = (left, right) => BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0;
const earliest = (...values) => Math.min(...values.filter(Number.isSafeInteger));
const latest = (...values) => Math.max(...values.filter(Number.isSafeInteger));

const parseRelation = (document, kind) => {
	const userId = decimal(document.userid, `${kind}.userid`);
	const createdAt = timestamp(document.created_at, `${kind}.created_at`);
	if (kind.includes('tg')) return { userId, telegramUserId: decimal(document.chat_id, `${kind}.chat_id`), createdAt };
	return { userId, email: email(document.email, `${kind}.email`), createdAt, verified: document.verified !== false };
};

const uniqueRelations = (relations, keyOf, label) => {
	const result = new Map();
	for (const relation of relations) {
		const key = keyOf(relation);
		const current = result.get(key);
		if (current && JSON.stringify(current) !== JSON.stringify(relation)) fail(`${label} contains conflicting duplicate relations`);
		result.set(key, relation);
	}
	return result;
};

const assertSymmetric = (left, right, label) => {
	if (left.size !== right.size) fail(`${label} forward/reverse counts differ (${left.size}/${right.size})`);
	for (const key of left.keys()) if (!right.has(key)) fail(`${label} forward/reverse relation is missing`);
};

export const parseLegacyPassportBackup = (backup) => {
	if (!backup || typeof backup !== 'object' || !Array.isArray(backup.docs)) fail('backup must contain a docs array');
	const documents = backup.docs;
	const withPrefix = (prefix) => documents.filter((document) => String(document?._id ?? '').startsWith(prefix));
	const userTelegramForward = uniqueRelations(withPrefix('userid-tgfromid:').map((document) => parseRelation(document, 'userid-tgfromid')), (item) => relationKey(item.userId, item.telegramUserId), 'Telegram');
	const userTelegramReverse = uniqueRelations(withPrefix('tgfromid:').filter((document) => String(document._id).includes(':userid:')).map((document) => parseRelation(document, 'tgfromid-userid')), (item) => relationKey(item.userId, item.telegramUserId), 'Telegram');
	const userEmailForward = uniqueRelations(withPrefix('userid-email:').map((document) => parseRelation(document, 'userid-email')), (item) => relationKey(item.userId, item.email), 'email');
	const userEmailReverse = uniqueRelations(withPrefix('email-userid:').map((document) => parseRelation(document, 'email-userid')), (item) => relationKey(item.userId, item.email), 'email');
	assertSymmetric(userTelegramForward, userTelegramReverse, 'Telegram');
	assertSymmetric(userEmailForward, userEmailReverse, 'email');

	const telegramOwners = new Map();
	for (const relation of userTelegramForward.values()) {
		const owner = telegramOwners.get(relation.telegramUserId);
		if (owner && owner !== relation.userId) fail('one Telegram identity belongs to multiple users');
		telegramOwners.set(relation.telegramUserId, relation.userId);
	}
	const emailOwners = new Map();
	for (const relation of userEmailForward.values()) {
		if (!relation.verified) fail('a persisted user email is not verified');
		const owner = emailOwners.get(relation.email);
		if (owner && owner !== relation.userId) fail('one email belongs to multiple users');
		emailOwners.set(relation.email, relation.userId);
	}

	const profiles = new Map();
	for (const document of withPrefix('tgfromid:').filter((item) => String(item._id).endsWith(':profile'))) {
		const telegramUserId = decimal(document.chat_id, 'profile.chat_id');
		const updatedAt = timestamp(document.updated_at, 'profile.updated_at');
		const current = profiles.get(telegramUserId);
		if (!current || updatedAt > current.updatedAt) profiles.set(telegramUserId, {
			name: [document.first_name, document.last_name].filter((item) => typeof item === 'string' && item.trim()).join(' ') || String(document.username ?? ''),
			updatedAt,
		});
	}

	const usersById = new Map();
	const ensureUser = (userId) => {
		let user = usersById.get(userId);
		if (!user) {
			user = { userId, telegram: [], emails: [] };
			usersById.set(userId, user);
		}
		return user;
	};
	for (const relation of userTelegramForward.values()) ensureUser(relation.userId).telegram.push(relation);
	for (const relation of userEmailForward.values()) ensureUser(relation.userId).emails.push(relation);
	for (const user of usersById.values()) {
		if (!user.telegram.length || !user.emails.length) fail(`user ${user.userId} does not have both Telegram and email identity`);
		user.telegram.sort((left, right) => left.createdAt - right.createdAt || sortIds(left.telegramUserId, right.telegramUserId));
		user.emails.sort((left, right) => left.createdAt - right.createdAt || left.email.localeCompare(right.email));
		const preferredTelegram = user.telegram.find((item) => profiles.has(item.telegramUserId)) ?? user.telegram[0];
		const profile = profiles.get(preferredTelegram.telegramUserId);
		user.nickname = nickname(profile?.name, preferredTelegram.telegramUserId);
		user.createdAt = earliest(...user.telegram.map((item) => item.createdAt), ...user.emails.map((item) => item.createdAt));
		user.updatedAt = latest(user.createdAt, ...user.telegram.map((item) => profiles.get(item.telegramUserId)?.updatedAt));
	}

	const telegramAccounts = [...userTelegramForward.values()].map((relation) => {
		const profile = profiles.get(relation.telegramUserId);
		return {
			...relation,
			chatId: relation.telegramUserId,
			nickname: nickname(profile?.name, relation.telegramUserId),
			updatedAt: latest(relation.createdAt, profile?.updatedAt),
		};
	}).sort((left, right) => sortIds(left.telegramUserId, right.telegramUserId));
	const emails = [...userEmailForward.values()].map((relation) => ({
		...relation,
		isPrimary: usersById.get(relation.userId).emails[0].email === relation.email,
		updatedAt: relation.createdAt,
	})).sort((left, right) => left.email.localeCompare(right.email));

	const telegramEmailDocuments = withPrefix('tgfromid:').filter((document) => String(document._id).includes(':email:'));
	const emailTelegramDocuments = withPrefix('email-tgfromid:');
	const parseOtp = (document, label) => {
		const telegramUserId = decimal(document.chat_id, `${label}.chat_id`);
		const normalizedEmail = email(document.email, `${label}.email`);
		const createdAt = timestamp(document.created_at, `${label}.created_at`);
		return {
			telegramUserId,
			chatId: telegramUserId,
			email: normalizedEmail,
			verified: document.verified === true,
			attemptCount: Number.isSafeInteger(document.attempt_count) && document.attempt_count >= 0 ? document.attempt_count : 0,
			createdAt,
		};
	};
	const otpKey = (item) => relationKey(item.telegramUserId, item.email, String(item.verified));
	const telegramOtps = uniqueRelations(telegramEmailDocuments.map((document) => parseOtp(document, 'tgfromid-email')), otpKey, 'OTP');
	const reverseOtps = uniqueRelations(emailTelegramDocuments.map((document) => parseOtp(document, 'email-tgfromid')), otpKey, 'OTP');
	assertSymmetric(telegramOtps, reverseOtps, 'OTP');
	for (const otp of telegramOtps.values()) {
		if (!otp.verified) continue;
		const telegramOwner = telegramOwners.get(otp.telegramUserId);
		const emailOwner = emailOwners.get(otp.email);
		if (!telegramOwner || telegramOwner !== emailOwner) fail('verified OTP does not match its Telegram/email owner');
	}
	const otps = [...telegramOtps.values()].map((item) => ({
		...item,
		status: item.verified ? 'used' : 'expired',
		expiresAt: item.createdAt + 10 * 60_000,
	})).sort((left, right) => left.createdAt - right.createdAt);

	let skippedNonPrivateMenus = 0;
	const menus = [];
	for (const document of withPrefix('tgfromid:').filter((item) => String(item._id).endsWith(':menu'))) {
		const telegramUserId = decimal(document.chat_id, 'menu.chat_id', false);
		if (BigInt(telegramUserId) <= 0n) {
			skippedNonPrivateMenus += 1;
			continue;
		}
		const messageId = decimal(document.message_id, 'menu.message_id');
		const updatedAt = timestamp(document.updated_at, 'menu.updated_at');
		const mode = document.mode === 'bind_email' ? 'email' : document.mode === 'verify_email' ? 'otp' : 'menu';
		menus.push({ telegramUserId, chatId: telegramUserId, messageId, mode, createdAt: updatedAt, updatedAt });
	}
	menus.sort((left, right) => sortIds(left.telegramUserId, right.telegramUserId));

	return {
		users: [...usersById.values()].sort((left, right) => sortIds(left.userId, right.userId)),
		telegramAccounts,
		emails,
		otps,
		menus,
		stats: {
			documents: documents.length,
			users: usersById.size,
			telegramAccounts: telegramAccounts.length,
			emails: emails.length,
			otps: otps.length,
			menus: menus.length,
			skippedNonPrivateMenus,
			skippedGroupPrompts: withPrefix('group_prompt:').length,
			skippedSso: withPrefix('sso:').length,
		},
	};
};

const requiredTables = ['global_telegram_bots', 'passport_users', 'passport_telegram_accounts', 'passport_emails', 'passport_user_emails', 'passport_email_otp', 'passport_telegram_menus'];

let databaseHelpersPromise;
const loadDatabaseHelpers = () => databaseHelpersPromise ??= (async () => {
	const directory = await mkdtemp(join(tmpdir(), 'quick-react-legacy-passport-'));
	try {
		const result = await build({
			stdin: {
				contents: "export * from './server/database/sqlite.mts'; export * from './server/database/sql.mts'; export * from './server/database/schema.mts';",
				resolveDir: resolve(import.meta.dirname, '..'),
				sourcefile: 'legacy-passport-database-entry.mts',
			},
			bundle: true,
			format: 'esm',
			platform: 'node',
			write: false,
		});
		const file = join(directory, 'database.mjs');
		await writeFile(file, result.outputFiles[0].contents);
		return await import(pathToFileURL(file));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
})();

const requireTables = async (listTables, database, tables) => {
	const existing = new Set((await listTables(database)).map((row) => row.name));
	for (const table of tables) if (!existing.has(table)) fail(`target table ${table} is missing; run site migrations first`);
};

const changes = (result) => Number(result.meta?.changes ?? 0);

class DryRunRollback extends Error {
	constructor(result) { super('dry-run rollback'); this.result = result; }
}

export const importLegacyPassportData = async ({ parsed, databaseFile, globalDatabaseFile = databaseFile, botId: botIdValue, dryRun = false }) => {
	const botId = decimal(botIdValue, 'bot_id');
	const { createSqliteAdapter, firstSql, listTables, runSql, sql } = await loadDatabaseHelpers();
	const database = createSqliteAdapter(databaseFile, { readBigInts: true });
	const globalDatabase = resolve(globalDatabaseFile) === resolve(databaseFile) ? database : createSqliteAdapter(globalDatabaseFile, { readBigInts: true });
	try {
		await requireTables(listTables, database, requiredTables.slice(1));
		await requireTables(listTables, globalDatabase, requiredTables.slice(0, 1));
		const bot = await firstSql(globalDatabase, sql(globalDatabase).select({ table: 'global_telegram_bots', columns: { id: { column: 'id', cast: 'text' } }, where: [{ column: 'id', value: BigInt(botId) }] }));
		if (!bot) fail(`global Telegram bot ${botId} does not exist`);
		const imported = { users: 0, telegramAccounts: 0, emails: 0, userEmails: 0, otps: 0, menus: 0 };
		try {
			const result = await database.transaction(async (target) => {
				for (const user of parsed.users) imported.users += changes(await runSql(target, sql(target).ignoreInsert('passport_users', ['user_id'], { user_id: BigInt(user.userId), nickname: user.nickname, status: 'enabled', created_at: user.createdAt, updated_at: user.updatedAt })));
				for (const account of parsed.telegramAccounts) {
					const existing = await firstSql(target, sql(target).select({ table: 'passport_telegram_accounts', columns: { user_id: { column: 'user_id', cast: 'text' } }, where: [{ column: 'bot_id', value: BigInt(botId) }, { column: 'telegram_user_id', value: BigInt(account.telegramUserId) }] }));
					if (existing && existing.user_id !== account.userId) fail(`Telegram identity ${account.telegramUserId} is already owned by another user`);
					if (!existing) imported.telegramAccounts += changes(await runSql(target, sql(target).insert('passport_telegram_accounts', { user_id: BigInt(account.userId), bot_id: BigInt(botId), telegram_user_id: BigInt(account.telegramUserId), chat_id: BigInt(account.chatId), nickname: account.nickname, created_at: account.createdAt, updated_at: account.updatedAt })));
				}
				for (const item of parsed.emails) {
					let existingEmail = await firstSql(target, sql(target).select({ table: 'passport_emails', columns: { id: { column: 'id', cast: 'text' }, verified: 'verified', updated_at: 'updated_at' }, where: [{ column: 'email', value: item.email }] }));
					if (!existingEmail) {
						const insertResult = await runSql(target, sql(target).insert('passport_emails', { email: item.email, verified: 1, created_at: item.createdAt, updated_at: item.updatedAt }));
						imported.emails += changes(insertResult);
						existingEmail = { id: String(insertResult.meta?.lastRowId ?? ''), verified: 1, updated_at: item.updatedAt };
						if (!existingEmail.id) fail(`email ${item.email} insert did not return an id`);
					} else if (!Number(existingEmail.verified)) {
						imported.emails += changes(await runSql(target, sql(target).update('passport_emails', { verified: 1, updated_at: Math.max(Number(existingEmail.updated_at), item.updatedAt) }, [{ column: 'id', value: BigInt(existingEmail.id) }, { column: 'verified', value: 0 }])));
					}
					const owner = await firstSql(target, sql(target).select({ table: 'passport_user_emails', columns: { user_id: { column: 'user_id', cast: 'text' } }, where: [{ column: 'email_id', value: BigInt(existingEmail.id) }] }));
					if (owner && owner.user_id !== item.userId) fail(`email ${item.email} is already owned by another user`);
					if (!owner) imported.userEmails += changes(await runSql(target, sql(target).insert('passport_user_emails', { user_id: BigInt(item.userId), email_id: BigInt(existingEmail.id), is_primary: item.isPrimary ? 1 : 0, created_at: item.createdAt })));
				}
				for (const otp of parsed.otps) {
					const where = [{ column: 'bot_id', value: BigInt(botId) }, { column: 'telegram_user_id', value: BigInt(otp.telegramUserId) }, { column: 'email', value: otp.email }, { column: 'created_at', value: otp.createdAt }, { column: 'status', value: otp.status }];
					if (await firstSql(target, sql(target).select({ table: 'passport_email_otp', columns: { id: 'id' }, where, limit: 1 }))) continue;
					const placeholderHash = `legacy-${otp.status}:${createHash('sha256').update(`${botId}\u0000${otp.telegramUserId}\u0000${otp.email}\u0000${otp.createdAt}`).digest('hex')}`;
					imported.otps += changes(await runSql(target, sql(target).insert('passport_email_otp', { bot_id: BigInt(botId), telegram_user_id: BigInt(otp.telegramUserId), chat_id: BigInt(otp.chatId), email: otp.email, code_hash: placeholderHash, attempt_count: otp.attemptCount, status: otp.status, expires_at: otp.expiresAt, created_at: otp.createdAt })));
				}
				for (const menu of parsed.menus) imported.menus += changes(await runSql(target, sql(target).ignoreInsert('passport_telegram_menus', ['bot_id', 'telegram_user_id'], { bot_id: BigInt(botId), telegram_user_id: BigInt(menu.telegramUserId), chat_id: BigInt(menu.chatId), message_id: BigInt(menu.messageId), mode: menu.mode, created_at: menu.createdAt, updated_at: menu.updatedAt })));

				for (const user of parsed.users) if (!await firstSql(target, sql(target).select({ table: 'passport_users', columns: { found: 'user_id' }, where: [{ column: 'user_id', value: BigInt(user.userId) }] }))) fail(`user ${user.userId} was not imported`);
				for (const account of parsed.telegramAccounts) {
					const owner = await firstSql(target, sql(target).select({ table: 'passport_telegram_accounts', columns: { user_id: { column: 'user_id', cast: 'text' } }, where: [{ column: 'bot_id', value: BigInt(botId) }, { column: 'telegram_user_id', value: BigInt(account.telegramUserId) }] }));
					if (owner?.user_id !== account.userId) fail(`Telegram identity ${account.telegramUserId} failed verification`);
				}
				for (const item of parsed.emails) {
					const owner = await firstSql(target, sql(target).select({ table: 'passport_emails', alias: 'e', columns: { user_id: { column: 'ue.user_id', cast: 'text' }, verified: 'e.verified' }, joins: [{ table: 'passport_user_emails', alias: 'ue', left: 'ue.email_id', right: 'e.id' }], where: [{ column: 'e.email', value: item.email }] }));
					if (owner?.user_id !== item.userId || Number(owner.verified) !== 1) fail(`email ${item.email} failed verification`);
				}
				for (const otp of parsed.otps) {
					const found = await firstSql(target, sql(target).select({ table: 'passport_email_otp', columns: { found: 'id' }, where: [{ column: 'bot_id', value: BigInt(botId) }, { column: 'telegram_user_id', value: BigInt(otp.telegramUserId) }, { column: 'email', value: otp.email }, { column: 'created_at', value: otp.createdAt }, { column: 'status', value: otp.status }], limit: 1 }));
					if (!found) fail(`OTP history for Telegram identity ${otp.telegramUserId} failed verification`);
				}
				for (const menu of parsed.menus) {
					const found = await firstSql(target, sql(target).select({ table: 'passport_telegram_menus', columns: { found: 'bot_id' }, where: [{ column: 'bot_id', value: BigInt(botId) }, { column: 'telegram_user_id', value: BigInt(menu.telegramUserId) }] }));
					if (!found) fail(`menu for Telegram identity ${menu.telegramUserId} failed verification`);
				}
				const output = { ...parsed.stats, botId, dryRun, imported };
				if (dryRun) throw new DryRunRollback(output);
				return output;
			});
			return result;
		} catch (error) {
			if (error instanceof DryRunRollback) return error.result;
			throw error;
		}
	} finally {
		if (globalDatabase !== database) await globalDatabase.close();
		database.close();
	}
};

const usage = () => `Usage: node scripts/import-legacy-passport.mjs [options]\n\n` +
	`  --source <file>           CouchDB backup (default: ${defaultSource})\n` +
	`  --database <file>         Passport SQLite (default: ${defaultDatabase})\n` +
	`  --global-database <file>  Global SQLite when separate (default: --database)\n` +
	`  --bot-id <id>             Existing global_telegram_bots.id (required for import)\n` +
	`  --dry-run                 Parse only, or rollback a target validation when --bot-id is set\n`;

const parseArguments = (arguments_) => {
	const options = { source: defaultSource, database: defaultDatabase, globalDatabase: '', botId: '', dryRun: false, help: false };
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (argument === '--dry-run') options.dryRun = true;
		else if (argument === '--help' || argument === '-h') options.help = true;
		else if (['--source', '--database', '--global-database', '--bot-id'].includes(argument)) {
			const value = arguments_[index += 1];
			if (!value) fail(`${argument} requires a value`);
			options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
		} else fail(`unknown option ${argument}`);
	}
	return options;
};

export const runLegacyPassportImportCli = async (arguments_) => {
	const options = parseArguments(arguments_);
	if (options.help) {
		console.log(usage());
		return;
	}
	const backup = JSON.parse(await readFile(resolve(options.source), 'utf8'));
	const parsed = parseLegacyPassportBackup(backup);
	if (!options.botId) {
		if (!options.dryRun) fail('--bot-id is required unless --dry-run is used');
		console.log(JSON.stringify({ ...parsed.stats, dryRun: true, targetValidated: false }, null, 2));
		return;
	}
	const result = await importLegacyPassportData({
		parsed,
		databaseFile: resolve(options.database),
		globalDatabaseFile: resolve(options.globalDatabase || options.database),
		botId: options.botId,
		dryRun: options.dryRun,
	});
	console.log(JSON.stringify(result, null, 2));
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	runLegacyPassportImportCli(process.argv.slice(2)).catch((error) => {
		console.error(error instanceof Error ? error.message : 'Legacy Passport import failed');
		process.exitCode = 1;
	});
}
