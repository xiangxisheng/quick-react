import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectDirectory = resolve(import.meta.dirname, '..');
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-passport-'));

try {
	const bundle = await build({
		stdin: {
			contents: `export { createSqliteAdapter } from './server/database/sqlite.mts';
				export { getPassportSnowflakeGenerator, PASSPORT_SNOWFLAKE_EPOCH } from './server/modules/passport/snowflake.mts';
					export { confirmTelegramIdentityChoice, createTelegramIdentityChoice, issueTelegramEmailOtp, normalizePassportNickname, setPassportPassword, verifyPassportPasswordHistory, verifyTelegramEmailOtp } from './server/modules/passport/identity.mts';`,
			resolveDir: projectDirectory,
			sourcefile: 'passport-identity-test-entry.mts',
			loader: 'ts',
		},
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: 'node22',
		write: false,
	});
	const modulePath = join(temporaryDirectory, 'passport-identity.mjs');
	await writeFile(modulePath, bundle.outputFiles[0].contents);
	const passport = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`);
	const databaseFile = join(temporaryDirectory, 'passport.sqlite');
	let database = passport.createSqliteAdapter(databaseFile);
	for (const migration of ['0001_passport_identity.sql', '0002_telegram_onboarding.sql', '0003_telegram_webhook_updates.sql', '0004_telegram_identity_choices.sql']) {
		await database.exec(await readFile(join(projectDirectory, 'migrations/passport', migration), 'utf8'));
	}

	const generator = passport.getPassportSnowflakeGenerator(database, 7);
	const generated = await Promise.all(Array.from({ length: 5000 }, () => generator.next()));
	assert.equal(new Set(generated.map(String)).size, generated.length);
	assert.ok(generated.every((id) => ((id >> 12n) & 0x3ffn) === 7n));
	const maximumBeforeRestart = generated.reduce((maximum, id) => id > maximum ? id : maximum, 0n);
	database.close();
	database = passport.createSqliteAdapter(databaseFile);
	const afterRestart = await passport.getPassportSnowflakeGenerator(database, 7).next();
	assert.ok(afterRestart > maximumBeforeRestart);
	await database.prepare(`INSERT INTO passport_snowflake_state (worker_id, last_timestamp, updated_at)
		VALUES (?1, ?2, ?3)`).bind(8, Date.now() + 60_000, Date.now()).run();
	const rollbackSafe = await passport.getPassportSnowflakeGenerator(database, 8).next();
	assert.ok(Number((rollbackSafe >> 22n) + passport.PASSPORT_SNOWFLAKE_EPOCH) > Date.now());

	const firstIdentity = { botId: '1', telegramUserId: '9000000001', chatId: '9000000001', nickname: 'Very Long Telegram Nickname' };
	assert.equal(Array.from(passport.normalizePassportNickname(firstIdentity.nickname, firstIdentity.telegramUserId)).length, 12);
	const firstOtp = await passport.issueTelegramEmailOtp(database, firstIdentity, 'First@Example.com');
	assert.equal((await passport.verifyTelegramEmailOtp(database, 7, firstIdentity, '000000')).status, 'invalid');
	const created = await passport.verifyTelegramEmailOtp(database, 7, firstIdentity, firstOtp.code);
	assert.equal(created.status, 'created');
	assert.match(created.userId, /^\d+$/);

	await assert.rejects(passport.issueTelegramEmailOtp(database, firstIdentity, 'second@example.com'), (error) => error?.waitSeconds > 0);
	await database.prepare(`UPDATE passport_email_otp SET created_at = created_at - 61000 WHERE bot_id = ?1 AND telegram_user_id = ?2`)
		.bind(firstIdentity.botId, firstIdentity.telegramUserId).run();
	const secondEmailOtp = await passport.issueTelegramEmailOtp(database, firstIdentity, 'second@example.com');
	const linked = await passport.verifyTelegramEmailOtp(database, 7, firstIdentity, secondEmailOtp.code);
	assert.deepEqual(linked, { status: 'linked', userId: created.userId });

	const conflictingIdentity = { botId: '1', telegramUserId: '9000000002', chatId: '9000000002', nickname: '' };
	const conflictingOtp = await passport.issueTelegramEmailOtp(database, conflictingIdentity, 'first@example.com');
	const conflict = await passport.verifyTelegramEmailOtp(database, 7, conflictingIdentity, conflictingOtp.code);
	assert.deepEqual(conflict, { status: 'conflict', emailUserId: created.userId });
	assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM passport_users').first()).count, 1);
	const choice = await passport.createTelegramIdentityChoice(database, conflictingIdentity, created.userId, 'first@example.com');
	const confirmed = await passport.confirmTelegramIdentityChoice(database, 7, conflictingIdentity, choice.id);
	assert.deepEqual(confirmed, { status: 'linked', userId: created.userId });
	assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM passport_telegram_accounts WHERE user_id = ?1').bind(created.userId).first()).count, 2);

	await passport.setPassportPassword(database, created.userId, 'first-password');
	await passport.setPassportPassword(database, created.userId, 'second-password');
	assert.equal((await passport.verifyPassportPasswordHistory(database, created.userId, 'second-password')).status, 'current');
	assert.equal((await passport.verifyPassportPasswordHistory(database, created.userId, 'first-password')).status, 'old');
	assert.equal((await passport.verifyPassportPasswordHistory(database, created.userId, 'wrong-password')).status, 'invalid');
	database.close();
	console.log('passport identity test passed');
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
