import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-passport-login-'));
process.env.DEFAULT_DATABASE_FILE = join(temporaryDirectory, 'default.sqlite');
process.env.SKIP_SERVER_LISTEN = '1';
const originalFetch = globalThis.fetch;
const telegramActions = [];
let telegramMessageId = 9000;
globalThis.fetch = async (input, init) => {
	const url = String(input);
	if (!url.startsWith('https://api.telegram.org/bot')) return originalFetch(input, init);
	const method = url.slice(url.lastIndexOf('/') + 1);
	const body = init?.body ? JSON.parse(String(init.body)) : {};
	telegramActions.push({ method, body });
	if (method === 'sendMessage') return Response.json({ ok: true, result: { message_id: ++telegramMessageId } });
	if (method === 'editMessageText') return Response.json({ ok: true, result: { message_id: body.message_id } });
	if (method === 'answerCallbackQuery') return Response.json({ ok: true, result: true });
	return Response.json({ ok: false, description: `unsupported ${method}` }, { status: 400 });
};

try {
	const { app } = await import(`../dist/server.mjs?passport-login=${Date.now()}`);
	const database = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	const now = Date.now();
	database.prepare(`INSERT INTO global_site_hosts (hostname, site_key, status, created_at) VALUES (?, 'passport', 'enabled', ?)`).run('passport.test', now);
	database.prepare(`INSERT INTO global_sites
		(site_key, name, base_site_key, dsn, database_binding, status, passport_sso_enabled, migration_status, is_default, is_system)
		VALUES ('site1', 'Site 1', 'base', '', '', 'enabled', 1, 'ready', 0, 0)`).run();
	database.prepare(`INSERT INTO global_site_hosts (hostname, site_key, status, created_at) VALUES ('site1.test', 'site1', 'enabled', ?)`).run(now);
	database.prepare(`INSERT INTO global_telegram_bots
		(id, name, bot_token, bot_username, secret_token, webhook_hostname, status, created_at, updated_at)
		VALUES (1, 'login-bot', '1:test-token', 'passport_login_bot', 'login-secret', 'passport.test', 'enabled', ?, ?)`).run(now, now);
	const userId = '1000000000000000000';
	database.prepare(`INSERT INTO passport_users (user_id, nickname, status, created_at, updated_at) VALUES (?, 'PassportUser', 'enabled', ?, ?)`).run(userId, now, now);
	database.prepare(`INSERT INTO passport_emails (id, email, verified, created_at, updated_at) VALUES (101, 'user@example.com', 1, ?, ?)`).run(now, now);
	database.prepare(`INSERT INTO passport_user_emails (user_id, email_id, is_primary, created_at) VALUES (?, 101, 1, ?)`).run(userId, now);
	database.prepare(`INSERT INTO passport_telegram_accounts
		(id, user_id, bot_id, telegram_user_id, chat_id, nickname, created_at, updated_at)
		VALUES (201, ?, 1, 9001, 9001, 'PassportUser', ?, ?)`).run(userId, now, now);
	database.close();

	const request = async (path, options = {}) => {
		const headers = new Headers(options.headers);
		if (options.cookie) headers.set('cookie', options.cookie);
		if (options.body !== undefined) headers.set('content-type', 'application/json');
		return app.request(`http://${options.host ?? 'passport.test'}${path}`, {
			method: options.method,
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
	};
	const localSign = await (await request('/api/sign.php')).json();
	assert.equal(localSign.formPage.fields[0].name, 'username');
	const initial = await (await request('/api/passport/sso/sign.php')).json();
	assert.equal(initial.formPage.initialValues.step, 'email');
	const telegramSelection = await (await request('/api/passport/sso/sign.php', {
		method: 'POST', body: { step: 'email', email: 'USER@example.com' },
	})).json();
	assert.equal(telegramSelection.formPage.fields.find((field) => field.name === 'account_id').type, 'select');
	assert.equal(telegramSelection.currentValues.account_id, '201');
	const challengeResponse = await request('/api/passport/sso/sign.php', {
		method: 'POST', body: { step: 'telegram', email: 'user@example.com', account_id: '201' },
	});
	assert.equal(challengeResponse.status, 200);
	const challengeResult = await challengeResponse.json();
	const challengeId = challengeResult.currentValues.challenge_id;
	assert.match(challengeId, /^[0-9a-f-]{36}$/);
	const challengeDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	const challenge = challengeDatabase.prepare(`SELECT expected_number, status FROM passport_login_challenges WHERE id = ?`).get(challengeId);
	challengeDatabase.close();
	assert.equal(challenge.status, 'pending');
	assert.equal(telegramActions.at(-1).method, 'sendMessage');
	const webhook = (update) => request('/api/tgwebhook?bot_id=1', {
		method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'login-secret' }, body: update,
	});
	const callbackMessage = { message_id: telegramMessageId, chat: { id: 9001, type: 'private' } };
	assert.equal((await webhook({ update_id: 1, callback_query: {
		id: 'wrong-number', from: { id: 9001, first_name: 'PassportUser' }, data: `login:approve:${challengeId}:${challenge.expected_number === 99 ? 98 : challenge.expected_number + 1}`, message: callbackMessage,
	} })).status, 200);
	assert.equal((await request('/api/passport/sso/sign.php', { method: 'POST', body: { step: 'poll', challenge_id: challengeId } })).status, 200);
	assert.equal((await webhook({ update_id: 2, callback_query: {
		id: 'correct-number', from: { id: 9001, first_name: 'PassportUser' }, data: `login:approve:${challengeId}:${challenge.expected_number}`, message: callbackMessage,
	} })).status, 200);
	const loginResponse = await request('/api/passport/sso/sign.php', { method: 'POST', body: { step: 'poll', challenge_id: challengeId } });
	assert.equal(loginResponse.status, 200);
	const passportCookie = loginResponse.headers.get('set-cookie')?.split(';')[0];
	assert.match(passportCookie ?? '', /^passport_session=/);
	const signedIn = await (await request('/api/passport/sso/sign.php', { cookie: passportCookie })).json();
	assert.equal(signedIn.user.id, userId);
	assert.equal(signedIn.user.username, 'PassportUser');
	const businessSign = await (await request('/api/sign.php', { host: 'site1.test' })).json();
	assert.equal(businessSign.registrationAvailable, false);
	assert.equal(businessSign.formPage.initialValues.passport_hostname, 'passport.test');
	assert.equal((await request('/api/sign.php', { host: 'site1.test', method: 'PUT', body: { username: 'forbidden', password: 'forbidden' } })).status, 403);
	const businessStart = await (await request('/api/sign.php', { host: 'site1.test', method: 'POST', body: { passport_hostname: 'passport.test' } })).json();
	assert.equal(businessStart.redirectTo, 'https://passport.test/api/passport/sso/start?target_hostname=site1.test');
	const ssoStart = await request('/api/passport/sso/start?target_hostname=site1.test', { cookie: passportCookie });
	assert.equal(ssoStart.status, 302);
	const callbackUrl = new URL(ssoStart.headers.get('location'));
	assert.equal(callbackUrl.hostname, 'site1.test');
	const callbackResponse = await request(`${callbackUrl.pathname}${callbackUrl.search}`, { host: 'site1.test' });
	assert.equal(callbackResponse.status, 302);
	const siteCookie = callbackResponse.headers.get('set-cookie')?.split(';')[0];
	assert.match(siteCookie ?? '', /^passport_session=/);
	const businessSignedIn = await (await request('/api/sign.php', { host: 'site1.test', cookie: siteCookie })).json();
	assert.equal(businessSignedIn.user.id, userId);
	assert.equal((await request(`${callbackUrl.pathname}${callbackUrl.search}`, { host: 'site1.test' })).status, 409);
	assert.equal((await request('/api/sign.php', { host: 'site1.test', method: 'DELETE', cookie: siteCookie })).status, 200);
	assert.equal((await request('/api/passport/sso/sign.php', { method: 'DELETE', cookie: passportCookie })).status, 200);
	const completedDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	assert.equal(completedDatabase.prepare(`SELECT status FROM passport_login_challenges WHERE id = ?`).get(challengeId).status, 'consumed');
	assert.equal(completedDatabase.prepare(`SELECT COUNT(*) AS count FROM passport_sessions`).get().count, 0);
	assert.equal(completedDatabase.prepare(`SELECT COUNT(*) AS count FROM passport_site_sessions`).get().count, 0);
	assert.equal(completedDatabase.prepare(`SELECT status FROM passport_login_tickets`).get().status, 'consumed');
	completedDatabase.close();
	console.log('passport login test passed');
} finally {
	globalThis.fetch = originalFetch;
	await rm(temporaryDirectory, { recursive: true, force: true });
}
