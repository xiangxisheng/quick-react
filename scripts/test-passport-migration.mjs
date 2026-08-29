import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { importLegacyPassportData, parseLegacyPassportBackup } from './import-legacy-passport.mjs';

const projectDirectory = resolve(import.meta.dirname, '..');
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-passport-migration-'));
const databaseFile = join(temporaryDirectory, 'default.sqlite');

const userOne = '1998902917192482816';
const userTwo = '2057821118894440448';
const telegramOne = '9007199254740992';
const telegramTwo = '9007199254740993';
const telegramThree = '9007199254740994';
const created = '2026-01-01T00:00:00+00:00';

const relationDocuments = [
	[userOne, telegramOne, created],
	[userOne, telegramTwo, '2026-01-02T00:00:00+00:00'],
	[userTwo, telegramThree, '2026-01-03T00:00:00+00:00'],
].flatMap(([userid, chat_id, created_at]) => [
	{ _id: `userid-tgfromid:${userid}:${chat_id}`, userid, chat_id, created_at },
	{ _id: `tgfromid:${chat_id}:userid:${userid}`, userid, chat_id, created_at },
]);

const emailRelations = [
	[userOne, 'one@example.com', created],
	[userOne, 'second@example.com', '2026-01-04T00:00:00+00:00'],
	[userTwo, 'two@example.com', '2026-01-03T00:00:00+00:00'],
].flatMap(([userid, address, created_at]) => [
	{ _id: `userid-email:${userid}:${address}`, userid, email: address, verified: true, created_at },
	{ _id: `email-userid:${address}:${userid}`, userid, email: address, created_at },
]);

const otpDocuments = [
	[userOne, telegramOne, 'one@example.com', true, created],
	[userOne, telegramTwo, 'second@example.com', true, '2026-01-04T00:00:00+00:00'],
	[userTwo, telegramThree, 'two@example.com', true, '2026-01-03T00:00:00+00:00'],
	[undefined, '9007199254740995', 'pending@example.com', false, '2026-01-05T00:00:00+00:00'],
].flatMap(([userid, chat_id, address, verified, created_at]) => [
	{ _id: `tgfromid:${chat_id}:email:${address}`, chat_id, email: address, verified, attempt_count: verified ? 0 : 2, code: verified ? undefined : '123456', created_at },
	{ _id: `email-tgfromid:${address}:${chat_id}`, chat_id, email: address, verified, ...(userid ? { userid } : {}), created_at: new Date(Date.parse(created_at) + 30_000).toISOString() },
]);

const backup = {
	docs: [
		...relationDocuments,
		...emailRelations,
		...otpDocuments,
		{ _id: `tgfromid:${telegramOne}:profile`, chat_id: telegramOne, first_name: 'A very long Telegram nickname', username: 'one', updated_at: '2026-01-06T00:00:00+00:00' },
		{ _id: `tgfromid:${telegramOne}:menu`, chat_id: telegramOne, message_id: 101, mode: 'home', updated_at: '2026-01-06T00:00:00+00:00' },
		{ _id: `tgfromid:${telegramTwo}:menu`, chat_id: telegramTwo, message_id: 102, mode: 'bind_email', updated_at: '2026-01-06T00:00:00+00:00' },
		{ _id: `tgfromid:${telegramThree}:menu`, chat_id: telegramThree, message_id: 103, mode: 'verify_email', updated_at: '2026-01-06T00:00:00+00:00' },
		{ _id: 'tgfromid:-1000000000000:menu', chat_id: '-1000000000000', message_id: 104, mode: 'support', updated_at: '2026-01-06T00:00:00+00:00' },
		{ _id: 'group_prompt:-100:1', chat_id: '-100', actor_id: '1', message_id: 1, updated_at: '2026-01-06T00:00:00+00:00' },
		{ _id: 'sso:approve:ignored', nonce: 'ignored', created_at: 1765733642 },
	],
};

try {
	const database = new DatabaseSync(databaseFile);
	database.exec(await readFile(join(projectDirectory, 'migrations/global/0001_global_sites.sql'), 'utf8'));
	database.exec(await readFile(join(projectDirectory, 'migrations/global/0002_telegram_bots.sql'), 'utf8'));
	for (const migration of ['0001_passport_identity.sql', '0002_telegram_onboarding.sql', '0003_telegram_webhook_updates.sql', '0004_telegram_identity_choices.sql', '0005_passport_login.sql', '0006_passport_sso.sql', '0007_accounts_oidc.sql', '0008_accounts_oidc_logout.sql', '0009_accounts_oidc_code_claim.sql', '0010_accounts_external_login.sql', '0011_wechat_provider_mode.sql', '0012_external_qr_state.sql', '0013_wechat_redirect_domain.sql', '0014_pending_qr_state.sql', '0015_external_pending_qr_states.sql', '0016_accounts_username_and_email_otp.sql', '0017_oidc_strict_redirect_uri.sql']) {
		database.exec(await readFile(join(projectDirectory, 'migrations/passport', migration), 'utf8'));
	}
	database.prepare(`INSERT INTO global_sites (site_key, name, base_site_key, dsn, status, migration_status, is_default, is_system)
		VALUES ('passport', 'Passport', 'base', '', 'enabled', 'ready', 0, 1)`).run();
	database.prepare(`INSERT INTO global_site_hosts (hostname, site_key, status, created_at)
		VALUES ('passport.example.com', 'passport', 'enabled', 1)`).run();
	for (const id of [7, 8]) database.prepare(`INSERT INTO global_telegram_bots
		(id, name, bot_token, bot_username, secret_token, webhook_hostname, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'passport.example.com', 'disabled', 1, 1)`).run(id, `bot-${id}`, `token-${id}`, `bot_${id}`, `secret-${id}`);
	database.close();

	const parsed = parseLegacyPassportBackup(backup);
	assert.deepEqual(parsed.stats, {
		documents: backup.docs.length,
		users: 2,
		telegramAccounts: 3,
		emails: 3,
		otps: 4,
		menus: 3,
		skippedNonPrivateMenus: 1,
		skippedGroupPrompts: 1,
		skippedSso: 1,
	});
	assert.equal(Array.from(parsed.users[0].nickname).length, 12);
	assert.equal(parsed.otps.find((item) => item.email === 'pending@example.com').status, 'expired');
	assert.deepEqual(parsed.menus.map((item) => item.mode).sort(), ['email', 'menu', 'otp']);

	const first = await importLegacyPassportData({ parsed, databaseFile, botId: '7' });
	assert.deepEqual(first.imported, { users: 2, telegramAccounts: 3, emails: 3, userEmails: 3, otps: 4, menus: 3 });
	const second = await importLegacyPassportData({ parsed, databaseFile, botId: '7' });
	assert.deepEqual(second.imported, { users: 0, telegramAccounts: 0, emails: 0, userEmails: 0, otps: 0, menus: 0 });

	const resultDatabase = new DatabaseSync(databaseFile, { readOnly: true });
	assert.deepEqual(resultDatabase.prepare('SELECT CAST(user_id AS TEXT) AS user_id FROM passport_users ORDER BY user_id').all().map((row) => row.user_id), [userOne, userTwo]);
	assert.equal(resultDatabase.prepare('SELECT COUNT(*) AS count FROM passport_telegram_accounts WHERE bot_id = 7').get().count, 3);
	assert.equal(resultDatabase.prepare('SELECT COUNT(*) AS count FROM passport_user_emails').get().count, 3);
	assert.equal(resultDatabase.prepare("SELECT COUNT(*) AS count FROM passport_email_otp WHERE status = 'expired'").get().count, 1);
	assert.equal(resultDatabase.prepare("SELECT COUNT(*) AS count FROM passport_email_otp WHERE code_hash LIKE '%123456%'").get().count, 0);
	assert.equal(resultDatabase.prepare("SELECT COUNT(*) AS count FROM passport_telegram_menus WHERE mode = 'otp'").get().count, 1);
	resultDatabase.close();

	const conflictDatabase = new DatabaseSync(databaseFile);
	conflictDatabase.prepare(`INSERT INTO passport_telegram_accounts
		(user_id, bot_id, telegram_user_id, chat_id, nickname, created_at, updated_at)
		VALUES (?, 8, ?, ?, 'conflict', 1, 1)`).run(BigInt(userTwo), BigInt(telegramOne), BigInt(telegramOne));
	conflictDatabase.close();
	await assert.rejects(() => importLegacyPassportData({ parsed, databaseFile, botId: '8', dryRun: true }), /already owned by another user/);

	console.log('passport migration test passed');
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
