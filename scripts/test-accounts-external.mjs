import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-accounts-external-'));
process.env.DEFAULT_DATABASE_FILE = join(temporaryDirectory, 'default.sqlite');
process.env.SKIP_SERVER_LISTEN = '1';
const originalFetch = globalThis.fetch;
let deliveredCode = '';

globalThis.fetch = async (input, init) => {
	const url = new URL(String(input));
	if (url.href === 'https://oauth2.googleapis.com/token') {
		const body = new URLSearchParams(String(init?.body ?? ''));
		assert.equal(body.get('client_secret'), 'google-secret');
		return Response.json({ access_token: `google-token-${body.get('code')}` });
	}
	if (url.href === 'https://openidconnect.googleapis.com/v1/userinfo') {
		const conflict = new Headers(init?.headers).get('authorization')?.includes('google-conflict');
		return Response.json({ sub: conflict ? 'google-subject-2' : 'google-subject-1', name: 'Google Account', email: 'google@example.com', email_verified: true });
	}
	if (url.origin === 'https://api.weixin.qq.com' && url.pathname.endsWith('/access_token')) return Response.json({ access_token: 'wechat-access', openid: 'wechat-openid-1' });
	if (url.origin === 'https://api.weixin.qq.com' && url.pathname.endsWith('/userinfo')) return Response.json({ openid: 'wechat-openid-1', nickname: '微信测试用户' });
	if (url.href === 'https://dm.aliyuncs.com/') {
		const body = new URLSearchParams(String(init?.body ?? ''));
		assert.equal(body.get('Action'), 'SingleSendMail');
		const template = JSON.parse(body.get('Template'));
		deliveredCode = String(template.TemplateData.code);
		return Response.json({ RequestId: 'external-email-request', EnvId: 'external-email-message' });
	}
	return originalFetch(input, init);
};

const cookie = (response, name) => response.headers.getSetCookie().map((value) => value.split(';')[0]).find((value) => value.startsWith(`${name}=`));
const jsonRequest = (app, path, body, requestCookie = '') => app.request(`http://accounts.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(requestCookie ? { cookie: requestCookie } : {}) }, body: JSON.stringify(body) });

try {
	const { app } = await import(`../dist/server.mjs?accounts-external=${Date.now()}`);
	const database = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	const now = Date.now();
	database.prepare("INSERT INTO global_site_hosts (hostname, site_key, status, created_at) VALUES ('accounts.test', 'passport', 'enabled', ?)").run(now);
	for (const provider of [
		['google', 'Google', 'google-client', 'google-secret'],
		['wechat', '微信', 'wechat-app-id', 'wechat-secret'],
	]) database.prepare(`INSERT INTO passport_external_providers (id, display_name, client_id, client_secret, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, 'enabled', ?, ?)`).run(...provider, now, now);
	database.prepare(`INSERT INTO global_cloud_credentials (id, name, provider, access_key_id, access_key_secret, status, created_at, updated_at)
		VALUES (91, 'external-email', 'aliyun', 'mail-key', 'mail-secret', 'enabled', ?, ?)`).run(now, now);
	database.prepare(`INSERT INTO global_cloud_email_channels (id, cloud_credential_id, region, account_name, from_alias, reply_to_address, status, created_at, updated_at)
		VALUES (92, 91, 'cn-hangzhou', 'noreply@example.com', 'Accounts', 0, 'enabled', ?, ?)`).run(now, now);
	database.prepare(`INSERT INTO global_cloud_email_templates (id, template_key, template_type, name, subject, body_text, body_html, status, created_at, updated_at)
		VALUES (93, 'email_verification_external', 'email_verification', '外部身份邮箱验证码', '验证码 {{code}}', '验证码：{{code}}', '<p>验证码：{{code}}</p>', 'enabled', ?, ?)`).run(now, now);
	database.prepare(`INSERT INTO global_cloud_email_template_publications (template_id, cloud_credential_id, region, provider_template_id, content_hash, status, created_at, updated_at)
		VALUES (93, 91, 'cn-hangzhou', 'external-template', 'test', 'ready', ?, ?)`).run(now, now);
	database.prepare(`INSERT INTO global_cloud_email_bindings (site_key, channel_id, template_id, purpose, is_default, status, created_at, updated_at)
		VALUES ('passport', 92, 93, 'email_verification', 1, 'enabled', ?, ?)`).run(now, now);
	database.close();

	// 登录页是邮箱输入框 + 第三方按钮；未注册的邮箱先让用户确认。
	const sign = await (await app.request('http://accounts.test/api/accounts/sign.php')).json();
	assert.equal(sign.formPage.initialValues.step, 'email');
	assert.deepEqual(sign.formPage.actions.map((item) => item.key), ['provider:google', 'provider:wechat']);
	const unknownEmail = await jsonRequest(app, '/api/accounts/sign.php', { step: 'email', email: 'wechat@example.com' });
	const unknownEmailResult = await unknownEmail.json();
	assert.equal(unknownEmail.status, 200);
	assert.equal(unknownEmailResult.formPage.initialValues.step, 'email_confirm');
	assert.match(unknownEmailResult.formPage.description, /还没有注册/);
	const confirmed = await jsonRequest(app, '/api/accounts/sign.php', { step: 'email_confirm', email: 'wechat@example.com' });
	const confirmedResult = await confirmed.json();
	assert.deepEqual(confirmedResult.formPage.fields.find((field) => field.name === 'method').options.map((item) => item.value), ['google', 'wechat']);
	const signupEmailCookie = cookie(confirmed, 'accounts_signup_email');
	assert.ok(signupEmailCookie);
	// 换个邮箱回到登录页第一步。
	const changed = await (await app.request('http://accounts.test/api/accounts/sign.php?action=change_email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ step: 'email_confirm', email: 'wechat@example.com' }) })).json();
	assert.equal(changed.formPage.initialValues.step, 'email');

	const googleStart = await app.request('http://accounts.test/api/accounts/external/google');
	assert.equal(googleStart.status, 302);
	const googleStateCookie = cookie(googleStart, 'accounts_external_state');
	const googleAuthorization = new URL(googleStart.headers.get('location'));
	assert.equal(googleAuthorization.hostname, 'accounts.google.com');
	assert.equal(googleAuthorization.searchParams.get('code_challenge_method'), 'S256');
	const googleState = googleAuthorization.searchParams.get('state');
	const googleCallback = await app.request(`http://accounts.test/api/accounts/external/google?code=google-code&state=${encodeURIComponent(googleState)}`, { headers: { cookie: googleStateCookie } });
	assert.equal(googleCallback.status, 302);
	assert.ok(cookie(googleCallback, 'passport_session'));
	// 新用户还没有用户名，回到登录页继续补全。
	assert.match(googleCallback.headers.get('location'), /\/accounts\/sign/);
	const afterGoogle = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	assert.equal(afterGoogle.prepare("SELECT COUNT(*) AS count FROM passport_external_identities WHERE provider = 'google'").get().count, 1);
	assert.equal(afterGoogle.prepare("SELECT COUNT(*) AS count FROM passport_emails WHERE email = 'google@example.com' AND verified = 1").get().count, 1);
	afterGoogle.close();
	assert.equal((await app.request(`http://accounts.test/api/accounts/external/google?code=replay&state=${encodeURIComponent(googleState)}`, { headers: { cookie: googleStateCookie } })).status, 400);
	const googleConflictStart = await app.request('http://accounts.test/api/accounts/external/google');
	const googleConflictAuthorization = new URL(googleConflictStart.headers.get('location'));
	const googleConflictState = googleConflictAuthorization.searchParams.get('state');
	const googleConflict = await app.request(`http://accounts.test/api/accounts/external/google?code=google-conflict&state=${encodeURIComponent(googleConflictState)}`, { headers: { cookie: cookie(googleConflictStart, 'accounts_external_state') } });
	assert.equal(googleConflict.status, 400);
	assert.match((await googleConflict.json()).feedback.message, /先登录原账户/);
	const afterConflict = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	assert.equal(afterConflict.prepare('SELECT COUNT(*) AS count FROM passport_users').get().count, 1);
	assert.equal(afterConflict.prepare("SELECT COUNT(*) AS count FROM passport_external_identities WHERE provider = 'google'").get().count, 1);
	afterConflict.close();

	const forwardedHeaders = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'passport.example.test' };
	const wechatStart = await app.request('http://accounts.test/api/accounts/external/wechat', { headers: forwardedHeaders });
	const wechatStateCookie = cookie(wechatStart, 'accounts_external_state');
	const wechatAuthorization = new URL(wechatStart.headers.get('location'));
	assert.equal(wechatAuthorization.hostname, 'open.weixin.qq.com');
	assert.equal(wechatAuthorization.searchParams.get('scope'), 'snsapi_login');
	assert.equal(wechatAuthorization.searchParams.get('redirect_uri'), 'https://passport.example.test/api/accounts/external/wechat');
	const wechatState = wechatAuthorization.searchParams.get('state');
	const wechatCallback = await app.request(`http://accounts.test/api/accounts/external/wechat?code=wechat-code&state=${encodeURIComponent(wechatState)}`, { headers: { ...forwardedHeaders, cookie: wechatStateCookie } });
	assert.equal(wechatCallback.status, 302);
	const pendingCookie = cookie(wechatCallback, 'accounts_external_pending');
	assert.ok(pendingCookie);
	const beforeEmail = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	assert.equal(beforeEmail.prepare("SELECT COUNT(*) AS count FROM passport_external_identities WHERE provider = 'wechat'").get().count, 0);
	assert.equal(beforeEmail.prepare('SELECT COUNT(*) AS count FROM passport_users').get().count, 1);
	beforeEmail.close();
	const emailForm = await (await app.request('http://accounts.test/api/accounts/sign.php', { headers: { cookie: `${pendingCookie}; ${signupEmailCookie}` } })).json();
	assert.equal(emailForm.formPage.initialValues.step, 'external_email');
	// 第一步输入过的邮箱会预填到验证步骤。
	assert.equal(emailForm.formPage.initialValues.email, 'wechat@example.com');
	const issued = await jsonRequest(app, '/api/accounts/sign.php', { step: 'external_email', email: 'wechat@example.com' }, pendingCookie);
	assert.equal(issued.status, 200);
	assert.match(deliveredCode, /^\d{6}$/);
	assert.equal((await (await jsonRequest(app, '/api/accounts/sign.php', { step: 'external_verify', code: '000000' }, pendingCookie)).json()).feedback.type, 'error');
	const verified = await jsonRequest(app, '/api/accounts/sign.php', { step: 'external_verify', code: deliveredCode }, pendingCookie);
	assert.equal(verified.status, 200);
	const wechatSession = cookie(verified, 'passport_session');
	assert.ok(wechatSession);
	// 建号后立即进入用户名补全，不直接跳转。
	const verifiedResult = await verified.json();
	assert.equal(verifiedResult.formPage.initialValues.step, 'set_username');
	assert.equal(verifiedResult.redirectTo, undefined);
	const completed = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	assert.equal(completed.prepare("SELECT COUNT(*) AS count FROM passport_external_identities WHERE provider = 'wechat'").get().count, 1);
	assert.equal(completed.prepare("SELECT COUNT(*) AS count FROM passport_emails WHERE email = 'wechat@example.com' AND verified = 1").get().count, 1);
	assert.equal(completed.prepare("SELECT COUNT(*) AS count FROM passport_external_pending_identities WHERE status = 'completed'").get().count, 1);
	completed.close();
	// 用户名必填且有格式限制，密码可以跳过。
	assert.equal((await (await app.request('http://accounts.test/api/accounts/sign.php', { headers: { cookie: wechatSession } })).json()).formPage.initialValues.step, 'set_username');
	for (const username of ['abc', 'Wechat1', 'wechat_1', '1wechat', 'admin', 'wechatuser2026x']) {
		const rejected = await jsonRequest(app, '/api/accounts/sign.php', { step: 'set_username', username }, wechatSession);
		assert.equal(rejected.status, 400, `用户名 ${username} 应该被拒绝`);
	}
	const namedResponse = await jsonRequest(app, '/api/accounts/sign.php', { step: 'set_username', username: 'wechat2026' }, wechatSession);
	const named = await namedResponse.json();
	assert.equal(namedResponse.status, 200);
	assert.equal(named.formPage.initialValues.step, 'set_password');
	assert.deepEqual(named.formPage.actions.map((action) => action.key), ['skip_password']);
	assert.equal((await jsonRequest(app, '/api/accounts/sign.php', { step: 'set_username', username: 'wechat2027' }, wechatSession)).status, 400);
	const skipped = await (await app.request('http://accounts.test/api/accounts/sign.php?action=skip_password', { method: 'POST', headers: { 'content-type': 'application/json', cookie: wechatSession }, body: JSON.stringify({ step: 'set_password' }) })).json();
	assert.equal(skipped.redirectTo, '/');
	// 跳过只对本次登录生效，下次进入登录页仍然提示设置密码。
	assert.equal((await (await app.request('http://accounts.test/api/accounts/sign.php', { headers: { cookie: wechatSession } })).json()).formPage.initialValues.step, 'set_password');
	assert.equal((await jsonRequest(app, '/api/accounts/sign.php', { step: 'set_password', password: 'wechat-password-1', password_confirm: 'other' }, wechatSession)).status, 400);
	assert.equal((await jsonRequest(app, '/api/accounts/sign.php', { step: 'set_password', password: 'short', password_confirm: 'short' }, wechatSession)).status, 400);
	const savedPassword = await jsonRequest(app, '/api/accounts/sign.php', { step: 'set_password', password: 'wechat-password-1', password_confirm: 'wechat-password-1' }, wechatSession);
	assert.equal(savedPassword.status, 200);
	assert.equal((await savedPassword.json()).redirectTo, '/');
	// 设置完成后登录页回到身份绑定表单。
	assert.equal((await (await app.request('http://accounts.test/api/accounts/sign.php', { headers: { cookie: wechatSession } })).json()).formPage.initialValues.step, 'method');

	// 已注册邮箱走密码登录：第一步给出密码表单，密码错误有提示。
	const knownEmail = await (await jsonRequest(app, '/api/accounts/sign.php', { step: 'email', email: 'wechat@example.com' })).json();
	assert.equal(knownEmail.formPage.initialValues.step, 'password');
	assert.deepEqual(knownEmail.formPage.actions.map((item) => item.key), ['forgot_password', 'change_email']);
	const wrongPassword = await (await jsonRequest(app, '/api/accounts/sign.php', { step: 'password', email: 'wechat@example.com', password: 'wrong-password' })).json();
	assert.match(wrongPassword.feedback.message, /邮箱或密码不正确/);
	// 忘记密码必须先做第三方认证。
	const forgot = await app.request('http://accounts.test/api/accounts/sign.php?action=forgot_password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ step: 'password', email: 'wechat@example.com' }) });
	const forgotResult = await forgot.json();
	assert.equal(forgotResult.formPage.initialValues.step, 'method');
	assert.match(forgotResult.formPage.description, /重设.*密码需要先完成一次第三方认证/);
	assert.ok(cookie(forgot, 'accounts_password_reset'));
	assert.equal((await jsonRequest(app, '/api/accounts/sign.php', { step: 'reset_password', password: 'new-password-1', password_confirm: 'new-password-1' }, wechatSession)).status, 409);
	const passwordLogin = await jsonRequest(app, '/api/accounts/sign.php', { step: 'password', email: 'wechat@example.com', password: 'wechat-password-1' });
	assert.equal(passwordLogin.status, 200);
	assert.ok(cookie(passwordLogin, 'passport_session'));
	assert.equal((await passwordLogin.json()).redirectTo, '/');

	const modeDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	modeDatabase.prepare("UPDATE passport_external_providers SET wechat_mode = 'official_account' WHERE id = 'wechat'").run();
	modeDatabase.close();
	const officialWechatStart = await app.request('http://accounts.test/api/accounts/external/wechat');
	assert.equal(officialWechatStart.status, 302);
	assert.match(officialWechatStart.headers.get('location'), /\/accounts\/external\/wechat/);
	console.log('accounts external identity test passed');
} finally {
	globalThis.fetch = originalFetch;
	await rm(temporaryDirectory, { recursive: true, force: true });
}
