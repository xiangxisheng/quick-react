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
	database.prepare(`INSERT INTO global_site_hosts (hostname, site_key, status, created_at) VALUES (?, 'global', 'enabled', ?)`).run('global.test', now);
	database.prepare(`INSERT INTO global_sites (site_key, name, base_site_key, dsn, status, migration_status, is_default, is_system)
		VALUES ('business', 'Business', 'base', '', 'enabled', 'ready', 0, 0)`).run();
	database.prepare(`INSERT INTO global_site_hosts (hostname, site_key, status, created_at) VALUES (?, 'business', 'enabled', ?)`).run('business.test', now);
	database.prepare(`INSERT INTO base_system_configs (key, value, updated_at) VALUES ('accounts-oidc-client', ?, ?)`).run(JSON.stringify({ enabled: true, issuer: 'https://passport.test', clientId: 'shared-client', clientSecret: 'shared-secret' }), now);
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
	// Accounts 内部认证接口下发邮箱输入框 + 第三方按钮，Telegram 按钮进入邮箱 + 消息批准；
	// 公开 /sign 页面已经取消，三个站点的 /api/sign 都只服务于当前页登录弹窗。
	const initial = await (await request('/api/accounts/sign.php')).json();
	assert.equal(initial.formPage.initialValues.step, 'email');
	assert.deepEqual(initial.formPage.externalLogins.map((item) => item.key), ['telegram']);
	assert.deepEqual((await (await request('/api/sign.php')).json()).formPage.fields.map((field) => field.name), ['action']);
	assert.deepEqual((await (await request('/api/sign.php', { host: 'global.test' })).json()).formPage.fields.map((field) => field.name), ['action']);
	assert.deepEqual((await (await request('/api/sign.php', { host: 'business.test' })).json()).formPage.fields.map((field) => field.name), ['action']);
	const staleLocalSubmit = await request('/api/sign.php', { method: 'POST', body: { username: 'old-form', password: 'password', remember: false } });
	assert.equal(staleLocalSubmit.status, 409);
	assert.match((await staleLocalSubmit.json()).feedback.message, /刷新页面/);

	// 和其它站点同一个开关：关掉账号登录就回到本站账号密码登录，重新开启又变回账号登录。
	const switchDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	const writeAccountsLogin = (enabled) => switchDatabase.prepare('INSERT INTO base_system_configs (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
		.run('accounts-oidc-client', JSON.stringify({ enabled, issuer: 'https://passport.test', clientId: 'shared-client', clientSecret: 'shared-secret' }), Date.now());
	writeAccountsLogin(false);
	for (const host of ['passport.test', 'global.test', 'business.test']) {
		const localForm = await (await request('/api/sign.php', { host })).json();
		assert.deepEqual(localForm.formPage.fields.map((field) => field.name), ['username', 'password', 'remember']);
	}
	const staleAccountsSubmit = await request('/api/sign.php', { host: 'business.test', method: 'POST', body: { step: 'email', email: 'user@example.com' } });
	assert.equal(staleAccountsSubmit.status, 409);
	assert.match((await staleAccountsSubmit.json()).feedback.message, /刷新页面/);
	writeAccountsLogin(true);
	switchDatabase.close();
	assert.deepEqual((await (await request('/api/sign.php')).json()).formPage.fields.map((field) => field.name), ['action']);
	assert.deepEqual((await (await request('/api/sign.php', { host: 'global.test' })).json()).formPage.fields.map((field) => field.name), ['action']);
	assert.deepEqual((await (await request('/api/sign.php', { host: 'business.test' })).json()).formPage.fields.map((field) => field.name), ['action']);
	const emailStep = await (await request('/api/accounts/sign.php?action=provider:telegram', { method: 'POST', body: { step: 'email', email: '' } })).json();
	assert.equal(emailStep.formPage.initialValues.step, 'telegram_email');
	const telegramSelection = await (await request('/api/accounts/sign.php', {
		method: 'POST', body: { step: 'telegram_email', email: 'USER@example.com' },
	})).json();
	assert.equal(telegramSelection.formPage.fields.find((field) => field.name === 'account_id').type, 'select');
	assert.equal(telegramSelection.currentValues.account_id, '201');
	const challengeResponse = await request('/api/accounts/sign.php', {
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
	assert.equal((await request('/api/accounts/sign.php', { method: 'POST', body: { step: 'poll', challenge_id: challengeId } })).status, 200);
	assert.equal((await webhook({ update_id: 2, callback_query: {
		id: 'correct-number', from: { id: 9001, first_name: 'PassportUser' }, data: `login:approve:${challengeId}:${challenge.expected_number}`, message: callbackMessage,
	} })).status, 200);
	const loginResponse = await request('/api/accounts/sign.php', { method: 'POST', body: { step: 'poll', challenge_id: challengeId } });
	assert.equal(loginResponse.status, 200);
	const passportCookie = loginResponse.headers.get('set-cookie')?.split(';')[0];
	assert.match(passportCookie ?? '', /^passport_session=/);
	// 历史用户没有用户名，登录后先补全再回跳。
	const loginResult = await loginResponse.json();
	assert.equal(loginResult.formPage.initialValues.step, 'set_username');
	assert.equal(loginResult.redirectTo, undefined);
	const signedIn = await (await request('/api/accounts/sign.php', { cookie: passportCookie })).json();
	assert.equal(signedIn.user.id, userId);
	assert.equal(signedIn.user.username, 'PassportUser');
	// 退出本站不能撤销仍在使用的 Accounts 会话。
	assert.equal((await request('/api/sign.php?logout=local', { method: 'DELETE', cookie: passportCookie })).status, 200);
	assert.equal((await (await request('/api/accounts/sign.php', { cookie: passportCookie })).json()).user.id, userId);
	const localSessionDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	localSessionDatabase.prepare("INSERT INTO base_system_users (id, username, password, roles, status, created_at, updated_at) VALUES (99, 'local_user', '!local', '[]', 'enabled', ?, ?)").run(Date.now(), Date.now());
	localSessionDatabase.prepare("INSERT INTO base_system_sessions (id, user_id, expires_at, created_at) VALUES ('local-passport-session', 99, ?, ?)").run(Date.now() + 3600000, Date.now());
	localSessionDatabase.close();
	const accountsLogout = await request('/api/accounts/sign.php', { method: 'DELETE', cookie: passportCookie });
	assert.equal(accountsLogout.status, 200);
	assert.deepEqual((await accountsLogout.json()).next, { action: 'reload' });
	const completedDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	assert.equal(completedDatabase.prepare("SELECT COUNT(*) AS count FROM base_system_sessions WHERE id = 'local-passport-session'").get().count, 1, '退出 Accounts 不应删除本站会话');
	assert.equal(completedDatabase.prepare(`SELECT status FROM passport_login_challenges WHERE id = ?`).get(challengeId).status, 'consumed');
	assert.equal(completedDatabase.prepare(`SELECT COUNT(*) AS count FROM passport_sessions`).get().count, 0);
	completedDatabase.close();
	console.log('passport login test passed');
} finally {
	globalThis.fetch = originalFetch;
	await rm(temporaryDirectory, { recursive: true, force: true });
}
