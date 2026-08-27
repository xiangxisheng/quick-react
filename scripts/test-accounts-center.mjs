import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-accounts-center-'));
process.env.DEFAULT_DATABASE_FILE = join(temporaryDirectory, 'default.sqlite');
process.env.SKIP_SERVER_LISTEN = '1';
const originalFetch = globalThis.fetch;
let deliveredCode = '';
globalThis.fetch = async (input, init) => {
	const url = new URL(String(input));
	if (url.href === 'https://dm.aliyuncs.com/') {
		const body = new URLSearchParams(String(init?.body ?? ''));
		deliveredCode = String(JSON.parse(body.get('Template')).TemplateData.code);
		return Response.json({ RequestId: 'center-email-request', EnvId: 'center-email-message' });
	}
	return originalFetch(input, init);
};

const userId = '1000000000000000001';
const primaryEmailId = '2000000000000000001';
const sessionId = 'accounts-center-session';
const cookie = `passport_session=${sessionId}`;

try {
	const { app } = await import(`../dist/server.mjs?accounts-center=${Date.now()}`);
	const database = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	const now = Date.now();
	database.prepare("INSERT INTO global_site_hosts (hostname, site_key, status, created_at) VALUES ('accounts.test', 'passport', 'enabled', ?)").run(now);
	database.prepare(`INSERT INTO global_cloud_credentials (id, name, provider, access_key_id, access_key_secret, status, created_at, updated_at)
		VALUES (91, 'center-email', 'aliyun', 'mail-key', 'mail-secret', 'enabled', ?, ?)`).run(now, now);
	database.prepare(`INSERT INTO global_cloud_email_channels (id, cloud_credential_id, region, account_name, from_alias, reply_to_address, status, created_at, updated_at)
		VALUES (92, 91, 'cn-hangzhou', 'noreply@example.com', 'Accounts', 0, 'enabled', ?, ?)`).run(now, now);
	database.prepare(`INSERT INTO global_cloud_email_templates (id, template_key, template_type, name, subject, body_text, body_html, status, created_at, updated_at)
		VALUES (93, 'email_verification_center', 'email_verification', '账户中心邮箱验证码', '验证码 {{code}}', '验证码：{{code}}', '<p>验证码：{{code}}</p>', 'enabled', ?, ?)`).run(now, now);
	database.prepare(`INSERT INTO global_cloud_email_template_publications (template_id, cloud_credential_id, region, provider_template_id, content_hash, status, created_at, updated_at)
		VALUES (93, 91, 'cn-hangzhou', 'center-template', 'test', 'ready', ?, ?)`).run(now, now);
	database.prepare(`INSERT INTO global_cloud_email_bindings (site_key, channel_id, template_id, purpose, is_default, status, created_at, updated_at)
		VALUES ('passport', 92, 93, 'email_verification', 1, 'enabled', ?, ?)`).run(now, now);
	database.prepare("INSERT INTO passport_users (user_id, nickname, status, created_at, updated_at) VALUES (?, '账户中心用户', 'enabled', ?, ?)").run(userId, now, now);
	database.prepare('INSERT INTO passport_usernames (user_id, username, created_at) VALUES (?, ?, ?)').run(userId, 'center2026', now);
	database.prepare("INSERT INTO passport_emails (id, email, verified, created_at, updated_at) VALUES (?, 'center@example.com', 1, ?, ?)").run(primaryEmailId, now, now);
	database.prepare('INSERT INTO passport_user_emails (user_id, email_id, is_primary, created_at) VALUES (?, ?, 1, ?)').run(userId, primaryEmailId, now);
	database.prepare('INSERT INTO passport_sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(sessionId, userId, now + 3600_000, now);
	database.close();

	const request = (path, options = {}) => app.request(`http://accounts.test${path}`, {
		method: options.method,
		headers: { ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...options.headers },
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});

	// 没有 Accounts 会话时账户中心接口和导航都不可用。
	assert.equal((await request('/api/panel/accounts/profile.php')).status, 401);
	const anonymousDocument = await (await request('/', { headers: { accept: 'text/html' } })).text();
	assert.equal(anonymousDocument.includes('账户中心'), false);
	const signedDocument = await (await request('/', { cookie, headers: { accept: 'text/html' } })).text();
	assert.ok(signedDocument.includes('账户中心'), '登录 Accounts 后导航里应该有账户中心');
	const initialData = JSON.parse(signedDocument.match(/__INITIAL_DATA__=(\{.*?\});<\/script>/s)[1]);
	assert.equal(initialData.auth.component, 'dropdown');
	// 头部显示的是 Accounts 昵称，而不是站点本地账号名。
	assert.equal(initialData.auth.currentUser.username, '账户中心用户');
	assert.deepEqual(initialData.auth.actions.map((action) => action.key), ['/panel/accounts', '/accounts/sign']);

	// 同时存在站点本地会话时，仍以 Accounts 昵称为准，并同时给出两套入口。
	const localDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	const localNow = Date.now();
	localDatabase.prepare("INSERT INTO base_system_users (id, username, password, roles, status, created_at, updated_at) VALUES (9, 'admin', '!local', '[\"admin\"]', 'enabled', ?, ?)").run(localNow, localNow);
	localDatabase.prepare('INSERT INTO base_system_sessions (id, user_id, expires_at, created_at) VALUES (?, 9, ?, ?)').run('local-session', localNow + 3600_000, localNow);
	localDatabase.close();
	const bothDocument = await (await request('/', { cookie: `${cookie}; quick_react_session=local-session`, headers: { accept: 'text/html' } })).text();
	const bothData = JSON.parse(bothDocument.match(/__INITIAL_DATA__=(\{.*?\});<\/script>/s)[1]);
	assert.equal(bothData.auth.currentUser.username, '账户中心用户', '不能显示站点本地账号名');
	assert.deepEqual(bothData.auth.actions.map((action) => action.key), ['/panel/accounts', '/accounts/sign', '/panel/me', '/sign']);

	// 概览。
	const overview = await (await request('/api/panel/accounts/overview.php', { cookie })).json();
	assert.deepEqual(overview.dashboard.statistics.map((item) => [item.key, item.value]), [['emails', 1], ['providers', 0], ['telegram', 0]]);
	assert.equal(overview.dashboard.recentRows.find((row) => row.key === 'username').value, 'center2026');
	assert.equal(overview.dashboard.recentRows.find((row) => row.key === 'password').value, '未设置');

	// 个人资料：用户名只读，昵称可改。
	const profile = await (await request('/api/panel/accounts/profile.php', { cookie })).json();
	assert.equal(profile.currentValues.username, 'center2026');
	assert.equal(profile.currentValues.primary_email, 'center@example.com');
	assert.ok(profile.formPage.fields.find((field) => field.name === 'username').readOnlyWhen);
	assert.equal((await request('/api/panel/accounts/profile.php', { method: 'PUT', cookie, body: { nickname: '  ' } })).status, 400);
	const savedProfile = await request('/api/panel/accounts/profile.php', { method: 'PUT', cookie, body: { nickname: '新昵称' } });
	assert.equal(savedProfile.status, 200);
	assert.equal((await savedProfile.json()).currentValues.nickname, '新昵称');

	// 邮箱管理只做展示、设为主邮箱和解绑。
	const emailsPath = '/api/panel/accounts/emails.php';
	const initialEmails = await (await request(emailsPath, { cookie })).json();
	assert.deepEqual(initialEmails.table.dataSource.map((row) => [row.email, row.is_primary, row.verified]), [['center@example.com', '1', '1']]);
	assert.equal(initialEmails.table.option.actions.toolbar, undefined);
	assert.deepEqual(initialEmails.table.option.actions.row.map((action) => action.key), ['primary', 'delete']);

	// 绑定邮箱：没有第三方认证凭证时不允许发送验证码。
	const bindPath = '/api/panel/accounts/bind-email.php';
	const needVerify = await (await request(bindPath, { cookie })).json();
	assert.equal(needVerify.formPage.initialValues.step, 'check');
	assert.match(needVerify.formPage.description, /必须先完成一次第三方认证/);
	assert.equal((await request(bindPath, { method: 'POST', cookie, body: { step: 'send', email: 'second@example.com' } })).status, 403);
	assert.equal(deliveredCode, '', '未通过第三方认证不应该发出验证码');

	// 带上第三方认证凭证后才能发送验证码并绑定。
	const verifiedCookie = `${cookie}; accounts_external_verified=1`;
	const bindForm = await (await request(bindPath, { cookie: verifiedCookie })).json();
	assert.equal(bindForm.formPage.initialValues.step, 'send');
	assert.equal((await request(bindPath, { method: 'POST', cookie: verifiedCookie, body: { step: 'send', email: 'center@example.com' } })).status, 400);
	assert.equal((await request(bindPath, { method: 'POST', cookie: verifiedCookie, body: { step: 'send', email: 'not-an-email' } })).status, 400);
	const sent = await request(bindPath, { method: 'POST', cookie: verifiedCookie, body: { step: 'send', email: 'second@example.com' } });
	assert.equal(sent.status, 200);
	assert.equal((await sent.json()).formPage.initialValues.step, 'verify');
	assert.match(deliveredCode, /^\d{6}$/);
	const pendingEmails = await (await request(emailsPath, { cookie })).json();
	assert.deepEqual(pendingEmails.table.dataSource.map((row) => [row.email, row.verified]), [['center@example.com', '1'], ['second@example.com', '0']]);
	assert.equal((await request(bindPath, { method: 'POST', cookie: verifiedCookie, body: { step: 'verify', code: '000000' } })).status, 409);
	assert.equal((await request(bindPath, { method: 'POST', cookie: verifiedCookie, body: { step: 'verify', code: deliveredCode } })).status, 200);
	const boundEmails = await (await request(emailsPath, { cookie })).json();
	assert.deepEqual(boundEmails.table.dataSource.map((row) => [row.email, row.is_primary, row.verified]), [['center@example.com', '1', '1'], ['second@example.com', '0', '1']]);
	const secondEmailId = boundEmails.table.dataSource.find((row) => row.email === 'second@example.com').email_id;

	// 主邮箱不能解绑，切换主邮箱后旧主邮箱才可以解绑。
	assert.equal((await request(emailsPath, { method: 'DELETE', cookie, body: [primaryEmailId] })).status, 409);
	assert.equal((await request(`${emailsPath}/${secondEmailId}?action=primary`, { method: 'POST', cookie })).status, 200);
	const switched = await (await request(emailsPath, { cookie })).json();
	assert.deepEqual(switched.table.dataSource.map((row) => [row.email, row.is_primary]), [['second@example.com', '1'], ['center@example.com', '0']]);
	assert.equal((await request(emailsPath, { method: 'DELETE', cookie, body: [primaryEmailId] })).status, 200);
	assert.equal((await request(emailsPath, { method: 'DELETE', cookie, body: [secondEmailId] })).status, 409);

	// 安全设置：首次设置密码，然后需要当前密码才能修改。
	const security = await (await request('/api/panel/accounts/security.php', { cookie })).json();
	assert.deepEqual(security.formPage.fields.map((field) => field.name), ['password', 'password_confirm']);
	assert.equal((await request('/api/panel/accounts/security.php', { method: 'PUT', cookie, body: { password: 'center-password-1', password_confirm: 'other' } })).status, 400);
	assert.equal((await request('/api/panel/accounts/security.php', { method: 'PUT', cookie, body: { password: 'center-password-1', password_confirm: 'center-password-1' } })).status, 200);
	const secured = await (await request('/api/panel/accounts/security.php', { cookie })).json();
	assert.deepEqual(secured.formPage.fields.map((field) => field.name), ['current_password', 'password', 'password_confirm']);
	assert.equal((await request('/api/panel/accounts/security.php', { method: 'PUT', cookie, body: { current_password: 'wrong', password: 'center-password-2', password_confirm: 'center-password-2' } })).status, 401);
	assert.equal((await request('/api/panel/accounts/security.php', { method: 'PUT', cookie, body: { current_password: 'center-password-1', password: 'center-password-2', password_confirm: 'center-password-2' } })).status, 200);
	// 旧密码登录会被拒绝并提示新密码的修改时间。
	const oldPasswordLogin = await request('/api/accounts/sign.php', { method: 'POST', body: { step: 'password', email: 'second@example.com', password: 'center-password-1' } });
	assert.equal(oldPasswordLogin.status, 401);
	assert.match((await oldPasswordLogin.json()).feedback.message, /密码已于.*修改/);
	const newPasswordLogin = await request('/api/accounts/sign.php', { method: 'POST', body: { step: 'password', email: 'second@example.com', password: 'center-password-2' } });
	assert.equal(newPasswordLogin.status, 200);
	assert.equal((await newPasswordLogin.json()).redirectTo, '/');

	console.log('accounts center test passed');
} finally {
	globalThis.fetch = originalFetch;
	await rm(temporaryDirectory, { recursive: true, force: true });
}
