import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-accounts-oidc-'));
process.env.DEFAULT_DATABASE_FILE = join(temporaryDirectory, 'default.sqlite');
process.env.SKIP_SERVER_LISTEN = '1';

const base64Url = (bytes) => Buffer.from(bytes).toString('base64url');
const sha256 = async (value) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const originalFetch = globalThis.fetch;

try {
	const { app } = await import(`../dist/server.mjs?accounts-oidc=${Date.now()}`);
	globalThis.fetch = (input, init) => {
		const url = new URL(String(input));
		return ['accounts.test', 'site1.test'].includes(url.hostname) ? app.request(url.toString(), init) : originalFetch(input, init);
	};
	const database = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	const now = Date.now(), userId = 1000000000000000000n, sessionId = crypto.randomUUID();
	database.prepare(`INSERT INTO global_site_hosts (hostname, site_key, status, created_at) VALUES ('accounts.test', 'passport', 'enabled', ?)`).run(now);
	database.prepare(`INSERT INTO global_sites (site_key, name, base_site_key, dsn, database_binding, status, migration_status, is_default, is_system)
		VALUES ('site1', 'Business Site', 'base', '', '', 'enabled', 'ready', 0, 0)`).run();
	database.prepare(`INSERT INTO global_site_hosts (hostname, site_key, status, created_at) VALUES ('site1.test', 'site1', 'enabled', ?)`).run(now);
	database.prepare(`INSERT INTO passport_users (user_id, nickname, status, created_at, updated_at) VALUES (?, 'AccountsUser', 'enabled', ?, ?)`).run(userId, now, now);
	database.prepare(`INSERT INTO passport_sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`).run(sessionId, userId, now + 3600_000, now);
	const clientId = 'acct_test', clientSecret = 'test-client-secret', verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
	const secretHash = Buffer.from(await sha256(clientSecret)).toString('hex'), challenge = base64Url(await sha256(verifier));
	database.prepare(`INSERT INTO passport_oidc_clients (id, name, secret_hash, redirect_uris, allowed_scopes, require_pkce, status, created_at, updated_at, backchannel_logout_uri)
		VALUES (?, 'Test Client', ?, '["https://client.test/callback","https://site1.test/api/accounts/oidc/callback"]', 'openid profile email', 1, 'enabled', ?, ?, 'https://site1.test/api/accounts/oidc/backchannel-logout')`).run(clientId, secretHash, now, now);
	database.prepare(`INSERT INTO base_system_configs (key, value, updated_at) VALUES ('accounts-oidc-client', ?, ?)`).run(JSON.stringify({ enabled: true, issuer: 'https://accounts.test', clientId, clientSecret }), now);
	database.close();
	const request = (path, options = {}) => app.request(`https://accounts.test${path}`, { method: options.method, headers: options.headers, body: options.body });
	const discovery = await (await request('/.well-known/openid-configuration')).json();
	assert.equal(discovery.issuer, 'https://accounts.test');
	assert.equal(discovery.authorization_endpoint, 'https://accounts.test/api/oidc/authorize');
	const forwardedDiscovery = await (await app.request('http://accounts.test/.well-known/openid-configuration', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'accounts.test' } })).json();
	assert.equal(forwardedDiscovery.issuer, 'https://accounts.test');
	const authorize = new URL('/api/oidc/authorize', 'https://accounts.test');
	authorize.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: 'https://client.test/callback', scope: 'openid profile', state: 'state-1', nonce: 'nonce-1', code_challenge: challenge, code_challenge_method: 'S256' }).toString();
	// 还没有设置用户名的账号即使已登录，也要先回登录页补全，不发授权码。
	const blocked = await request(`${authorize.pathname}${authorize.search}`, { headers: { cookie: `passport_session=${sessionId}` } });
	assert.equal(blocked.status, 302);
	assert.match(blocked.headers.get('location'), /^\/accounts\/sign/);
	// 从业务站点跳来登录时，登录页要说明来源并提供返回入口，避免用户回不去。
	const oidcRequestCookie = blocked.headers.getSetCookie().map((value) => value.split(';')[0]).find((value) => value.startsWith('accounts_oidc_request='));
	assert.ok(oidcRequestCookie);
	const fromClient = await (await request('/api/accounts/sign.php', { headers: { cookie: oidcRequestCookie } })).json();
	assert.match(fromClient.formPage.description, /正在为 client\.test 登录/);
	assert.deepEqual(fromClient.formPage.actions.map((action) => action.key), ['return_to_client']);
	assert.equal(fromClient.formPage.actions[0].label, '取消登录');
	const returned = await request('/api/accounts/sign.php?action=return_to_client', { method: 'POST', headers: { cookie: oidcRequestCookie, 'content-type': 'application/json' }, body: '{}' });
	const cancelled = await returned.json();
	// 弹窗里取消登录先关窗口，非弹窗场景才回落到来源站点。
	assert.equal(cancelled.closeWindow, true);
	assert.equal(cancelled.redirectTo, 'https://client.test');
	assert.ok(returned.headers.getSetCookie().some((value) => value.startsWith('accounts_oidc_request=;')));

	const usernameDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	usernameDatabase.prepare('INSERT INTO passport_usernames (user_id, username, created_at) VALUES (?, ?, ?)').run(String(userId), 'oidcuser1', Date.now());
	usernameDatabase.close();
	const authorized = await request(`${authorize.pathname}${authorize.search}`, { headers: { cookie: `passport_session=${sessionId}` } });
	assert.equal(authorized.status, 302);
	const callback = new URL(authorized.headers.get('location'));
	assert.equal(callback.origin, 'https://client.test'); assert.equal(callback.searchParams.get('state'), 'state-1');
	const tokenBody = new URLSearchParams({ grant_type: 'authorization_code', code: callback.searchParams.get('code'), redirect_uri: 'https://client.test/callback', client_id: clientId, client_secret: clientSecret, code_verifier: verifier });
	const tokenResponse = await request('/api/oidc/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: tokenBody.toString() });
	assert.equal(tokenResponse.status, 200);
	const tokens = await tokenResponse.json(); assert.match(tokens.id_token, /^[^.]+\.[^.]+\.[^.]+$/); assert.equal(tokens.token_type, 'Bearer');
	const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString());
	assert.equal(claims.iss, 'https://accounts.test'); assert.equal(claims.aud, clientId); assert.equal(claims.sub, String(userId)); assert.equal(claims.nonce, 'nonce-1');
	const userinfo = await (await request('/api/oidc/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } })).json();
	assert.equal(userinfo.sub, String(userId)); assert.equal(userinfo.name, 'AccountsUser');
	assert.equal((await request('/api/oidc/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: tokenBody.toString() })).status, 400);
	const jwks = await (await request('/api/oidc/jwks')).json(); assert.equal(jwks.keys[0].alg, 'RS256'); assert.ok(jwks.keys[0].n);
	// 控制面站点与 Accounts 用户完全分离：即使共库启用了 Accounts 登录，也始终是本站账号密码登录。
	const controlPanelSign = await (await app.request('http://localhost/api/sign.php')).json();
	assert.equal(controlPanelSign.formPage.passportLogin, undefined);
	assert.deepEqual(controlPanelSign.formPage.fields.map((field) => field.name), ['username', 'password', 'remember']);
	const controlPanelDocument = await (await app.request('http://localhost/', { headers: { accept: 'text/html' } })).text();
	const controlPanelData = JSON.parse(controlPanelDocument.match(/__INITIAL_DATA__=(\{.*?\});<\/script>/s)[1]);
	assert.deepEqual(controlPanelData.auth.actions.map((action) => [action.key, action.action]), [['/sign', 'navigate'], ['/sign-up', 'navigate']]);
	const controlPanelSdk = await app.request('http://localhost/api/sign.php', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'login' }) });
	assert.equal(controlPanelSdk.status, 409);
	assert.match((await controlPanelSdk.json()).feedback.message, /控制面站点使用本站账号密码登录/);
	// 控制面的本地账号仍然可以注册和登录。
	assert.equal((await app.request('http://localhost/api/sign.php', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'panel_admin', password: 'test-password-123' }) })).status, 401);

	// 启用 Accounts 登录的业务站点：需要登录的页面直接弹窗，不再跳登录页，也不给本地注册入口。
	const businessDocument = await (await app.request('https://site1.test/panel/admin.html', { headers: { accept: 'text/html' } })).text();
	const businessInitial = JSON.parse(businessDocument.match(/__INITIAL_DATA__=(\{.*?\});<\/script>/s)[1]);
	assert.deepEqual(businessInitial.auth.actions.map((action) => [action.key, action.action]), [['/sign', 'accounts-login']]);
	assert.equal(businessInitial.pageStatus.status, 401);
	assert.deepEqual(businessInitial.pageStatus.actions.map((action) => [action.label, action.action]), [['登录', 'accounts-login'], ['返回首页', 'navigate']]);
	const businessSign = await (await app.request('https://site1.test/api/sign.php')).json();
	assert.equal(businessSign.formPage.fields[0].name, 'action');
	// 业务站点不允许自动跳转到 Accounts，必须由用户点击按钮确认。
	// 只保留弹窗登录：既不自动跳转，也不整页跳走。
	assert.deepEqual(businessSign.formPage.passportLogin, { enabled: true });
	assert.match(businessSign.formPage.description, /本页不会自动跳转/);
	const businessStart = await app.request('https://site1.test/api/sign.php', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
	const loginCookie = businessStart.headers.get('set-cookie')?.split(';')[0];
	const businessAuthorizeUrl = (await businessStart.json()).redirectTo;
	const businessAuthorized = await app.request(businessAuthorizeUrl, { headers: { cookie: `passport_session=${sessionId}` } });
	const businessCallback = businessAuthorized.headers.get('location');
	const businessCallbackResponse = await app.request(businessCallback, { headers: { cookie: loginCookie } });
	// 弹窗回调直接返回关闭窗口的页面，不再中转到 /accounts/oidc/popup。
	assert.equal(businessCallbackResponse.status, 200);
	const popupBody = await businessCallbackResponse.clone().text();
	assert.match(popupBody, /postMessage/);
	assert.equal(popupBody.includes('/accounts/oidc/popup'), false);
	const businessSessionCookie = businessCallbackResponse.headers.getSetCookie().find((item) => item.startsWith('quick_react_session='))?.split(';')[0];
	assert.ok(businessSessionCookie);
	const signedInBusiness = await (await app.request('https://site1.test/api/sign.php', { headers: { cookie: businessSessionCookie } })).json();
	// Accounts 用户名通过 preferred_username 下发，业务站点用它替换 passport_<user_id> 占位名。
	assert.equal(claims.preferred_username, 'oidcuser1');
	assert.equal(signedInBusiness.user.username, 'oidcuser1');
	assert.deepEqual(signedInBusiness.formPage.passportLogin, { enabled: true });
	const businessUsers = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	assert.equal(businessUsers.prepare("SELECT COUNT(*) AS count FROM base_system_users WHERE username LIKE 'passport\\_%' ESCAPE '\\'").get().count, 0);
	businessUsers.close();
	const completed = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	assert.equal(completed.prepare('SELECT COUNT(*) AS count FROM base_oidc_accounts').get().count, 1); completed.close();
	assert.equal((await app.request('https://accounts.test/api/oidc/logout', { headers: { cookie: `passport_session=${sessionId}` } })).status, 200);
	const afterGlobalLogout = await (await app.request('https://site1.test/api/sign.php', { headers: { cookie: businessSessionCookie } })).json();
	assert.equal(afterGlobalLogout.user, null);
	console.log('accounts oidc test passed');
} finally {
	globalThis.fetch = originalFetch;
	await rm(temporaryDirectory, { recursive: true, force: true });
}
