import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

// 验证 global 与 passport 使用不同数据库时，Accounts 身份、账户中心和 OIDC 仍然可用。
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-accounts-split-'));
const globalFile = join(temporaryDirectory, 'default.sqlite');
const passportFile = join(temporaryDirectory, 'passport.sqlite');
process.env.DEFAULT_DATABASE_FILE = globalFile;
process.env.SKIP_SERVER_LISTEN = '1';
const originalFetch = globalThis.fetch;
let deliveredCode = '';
globalThis.fetch = async (input, init) => {
	const url = new URL(String(input));
	if (url.href === 'https://dm.aliyuncs.com/') {
		const body = new URLSearchParams(String(init?.body ?? ''));
		deliveredCode = String(JSON.parse(body.get('Template')).TemplateData.code);
		return Response.json({ RequestId: 'split-email-request', EnvId: 'split-email-message' });
	}
	return originalFetch(input, init);
};

const userId = '1000000000000000007';
const emailId = '2000000000000000007';
const sessionId = 'accounts-split-session';
const cookie = `passport_session=${sessionId}`;

try {
	// 第一次启动建立 global 结构并登记代码站点。
	await import(`../dist/server.mjs?accounts-split-boot=${Date.now()}`);
	const bootstrap = new DatabaseSync(globalFile);
	bootstrap.prepare("UPDATE global_sites SET dsn = ? WHERE site_key = 'passport'").run(`sqlite://${passportFile}`);
	bootstrap.close();

	// 第二次启动会把 passport 迁移到独立数据库文件。
	const { app } = await import(`../dist/server.mjs?accounts-split=${Date.now()}`);

	const globalDatabase = new DatabaseSync(globalFile);
	const now = Date.now();
	globalDatabase.prepare("INSERT INTO global_site_hosts (hostname, site_key, status, created_at) VALUES ('accounts.split.test', 'passport', 'enabled', ?)").run(now);
	globalDatabase.prepare(`INSERT INTO global_cloud_credentials (id, name, provider, access_key_id, access_key_secret, status, created_at, updated_at)
		VALUES (91, 'split-email', 'aliyun', 'mail-key', 'mail-secret', 'enabled', ?, ?)`).run(now, now);
	globalDatabase.prepare(`INSERT INTO global_cloud_email_channels (id, cloud_credential_id, region, account_name, from_alias, reply_to_address, status, created_at, updated_at)
		VALUES (92, 91, 'cn-hangzhou', 'noreply@example.com', 'Accounts', 0, 'enabled', ?, ?)`).run(now, now);
	globalDatabase.prepare(`INSERT INTO global_cloud_email_templates (id, template_key, template_type, name, subject, body_text, body_html, status, created_at, updated_at)
		VALUES (93, 'email_verification_split', 'email_verification', '分库邮箱验证码', '验证码 {{code}}', '验证码：{{code}}', '<p>验证码：{{code}}</p>', 'enabled', ?, ?)`).run(now, now);
	globalDatabase.prepare(`INSERT INTO global_cloud_email_template_publications (template_id, cloud_credential_id, region, provider_template_id, content_hash, status, created_at, updated_at)
		VALUES (93, 91, 'cn-hangzhou', 'split-template', 'test', 'ready', ?, ?)`).run(now, now);
	globalDatabase.prepare(`INSERT INTO global_cloud_email_bindings (site_key, channel_id, template_id, purpose, is_default, status, created_at, updated_at)
		VALUES ('passport', 92, 93, 'email_verification', 1, 'enabled', ?, ?)`).run(now, now);
	globalDatabase.close();

	const passportDatabase = new DatabaseSync(passportFile);
	passportDatabase.prepare("INSERT INTO passport_users (user_id, nickname, status, created_at, updated_at) VALUES (?, '分库用户', 'enabled', ?, ?)").run(userId, now, now);
	passportDatabase.prepare("INSERT INTO passport_emails (id, email, verified, created_at, updated_at) VALUES (?, 'split@example.com', 1, ?, ?)").run(emailId, now, now);
	passportDatabase.prepare('INSERT INTO passport_user_emails (user_id, email_id, is_primary, created_at) VALUES (?, ?, 1, ?)').run(userId, emailId, now);
	passportDatabase.prepare('INSERT INTO passport_sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(sessionId, userId, now + 3600_000, now);
	passportDatabase.close();

	const request = (path, options = {}) => app.request(`http://accounts.split.test${path}`, {
		method: options.method,
		headers: { ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...options.headers },
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});

	// 登录页读的是 passport 库里的邮箱：已注册但没设置密码时给出明确指引，未注册则先确认邮箱。
	const known = await request('/api/accounts/sign.php', { method: 'POST', body: { step: 'password', email: 'split@example.com', password: 'whatever' } });
	assert.equal(known.status, 409);
	assert.match((await known.json()).feedback.message, /还没有设置密码/);
	const unknown = await (await request('/api/accounts/sign.php', { method: 'POST', body: { step: 'password', email: 'nobody@example.com', password: 'whatever' } })).json();
	assert.equal(unknown.formPage.initialValues.step, 'email_confirm');

	// 用户名校验和补全流程只依赖 passport 库。
	const onboarding = await (await request('/api/accounts/sign.php', { cookie })).json();
	assert.equal(onboarding.formPage.initialValues.step, 'set_username');
	assert.equal((await request('/api/accounts/sign.php', { method: 'POST', cookie, body: { step: 'set_username', username: 'Split2026' } })).status, 400);
	assert.equal((await request('/api/accounts/sign.php', { method: 'POST', cookie, body: { step: 'set_username', username: 'split2026' } })).status, 200);
	// 身份数据落在 passport 库，global 库不参与。
	const splitPassport = new DatabaseSync(passportFile, { readOnly: true });
	assert.equal(splitPassport.prepare('SELECT username FROM passport_usernames WHERE user_id = ?').get(userId).username, 'split2026');
	splitPassport.close();
	const splitGlobal = new DatabaseSync(globalFile, { readOnly: true });
	assert.equal(splitGlobal.prepare('SELECT COUNT(*) AS count FROM passport_usernames').get().count, 0, '用户名不应该写进 global 库');
	assert.equal(splitGlobal.prepare('SELECT COUNT(*) AS count FROM passport_users').get().count, 0, '身份不应该写进 global 库');
	splitGlobal.close();

	// 账户中心：邮件模板和云凭据来自 global 库，验证码和绑定写在 passport 库。
	const emailsPath = '/api/panel/accounts/emails.php';
	const bindPath = '/api/panel/accounts/bind-email.php';
	const verifiedCookie = `${cookie}; accounts_external_verified=1`;
	assert.equal((await request(bindPath, { method: 'POST', cookie, body: { step: 'send', email: 'split-second@example.com' } })).status, 403);
	assert.equal((await request(bindPath, { method: 'POST', cookie: verifiedCookie, body: { step: 'send', email: 'split-second@example.com' } })).status, 200);
	assert.match(deliveredCode, /^\d{6}$/);
	const otpDatabase = new DatabaseSync(passportFile, { readOnly: true });
	assert.equal(otpDatabase.prepare("SELECT COUNT(*) AS count FROM passport_user_email_otps WHERE status = 'pending'").get().count, 1);
	otpDatabase.close();
	assert.equal((await request(bindPath, { method: 'POST', cookie: verifiedCookie, body: { step: 'verify', code: deliveredCode } })).status, 200);
	const boundEmails = await (await request(emailsPath, { cookie })).json();
	assert.deepEqual(boundEmails.table.dataSource.map((row) => row.email), ['split@example.com', 'split-second@example.com']);

	// 概览与个人资料同样只读 passport 库。
	const overview = await (await request('/api/panel/accounts/overview.php', { cookie })).json();
	assert.equal(overview.dashboard.recentRows.find((row) => row.key === 'username').value, 'split2026');
	assert.equal(overview.dashboard.statistics.find((item) => item.key === 'emails').value, 2);

	// 设置密码后可以直接用邮箱密码登录。
	assert.equal((await request('/api/panel/accounts/security.php', { method: 'PUT', cookie, body: { password: 'split-password-1', password_confirm: 'split-password-1' } })).status, 200);
	const passwordLogin = await request('/api/accounts/sign.php', { method: 'POST', body: { step: 'password', email: 'split@example.com', password: 'split-password-1' } });
	assert.equal(passwordLogin.status, 200);
	assert.equal((await passwordLogin.json()).redirectTo, '/');

	console.log('accounts split database test passed');
} finally {
	globalThis.fetch = originalFetch;
	await rm(temporaryDirectory, { recursive: true, force: true });
}
