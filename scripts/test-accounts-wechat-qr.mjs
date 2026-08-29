import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

// 微信公众号扫码登录：手机授权、电脑轮询拿会话，已绑定的身份不再要求邮箱验证码。
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-wechat-qr-'));
process.env.DEFAULT_DATABASE_FILE = join(temporaryDirectory, 'default.sqlite');
process.env.SKIP_SERVER_LISTEN = '1';
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
	const url = new URL(String(input));
	if (url.origin === 'https://api.weixin.qq.com' && url.pathname.endsWith('/access_token')) return Response.json({ access_token: 'wechat-access', openid: 'wechat-openid-1' });
	if (url.origin === 'https://api.weixin.qq.com' && url.pathname.endsWith('/userinfo')) return Response.json({ openid: 'wechat-openid-1', nickname: '微信用户' });
	return originalFetch(input, init);
};

const userId = '1000000000000000011';
const setCookie = (response, name) => response.headers.getSetCookie().map((value) => value.split(';')[0]).find((value) => value.startsWith(`${name}=`));

try {
	const { app } = await import(`../dist/server.mjs?wechat-qr=${Date.now()}`);
	const database = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	const now = Date.now();
	database.prepare("INSERT INTO global_site_hosts (hostname, site_key, status, created_at) VALUES ('accounts.test','passport','enabled',?)").run(now);
	database.prepare("INSERT INTO passport_external_providers (id,display_name,client_id,client_secret,status,created_at,updated_at,wechat_mode) VALUES ('wechat','微信','wechat-app','secret','enabled',?,?,'official_account')").run(now, now);
	database.prepare("INSERT INTO passport_users (user_id,nickname,status,created_at,updated_at) VALUES (?,'微信用户','enabled',?,?)").run(userId, now, now);
	database.prepare("INSERT INTO passport_usernames (user_id,username,created_at) VALUES (?,'wxuser2026',?)").run(userId, now);
	database.prepare("INSERT INTO passport_emails (id,email,verified,created_at,updated_at) VALUES (2000000000000000011,'wx@example.com',1,?,?)").run(now, now);
	database.prepare("INSERT INTO passport_user_emails (user_id,email_id,is_primary,created_at) VALUES (?,2000000000000000011,1,?)").run(userId, now);
	// 微信身份的 subject 是 client_id:openid。
	database.prepare("INSERT INTO passport_external_identities (user_id,provider,subject,profile,created_at,updated_at) VALUES (?,'wechat','wechat-app:wechat-openid-1','{}',?,?)").run(userId, now, now);
	database.close();

	// 电脑打开二维码页。
	const qr = await (await app.request('https://accounts.test/api/accounts/external/wechat?format=json')).json();
	assert.equal(qr.mode, 'qrcode');
	const state = new URL(qr.authorizationUrl).searchParams.get('state');
	assert.ok(state);
	assert.equal(qr.pollUrl, `/api/accounts/external/wechat?poll=${state}`);

	// 扫码前轮询是等待状态。
	assert.deepEqual(await (await app.request(`https://accounts.test${qr.pollUrl}`)).json(), { status: 'pending' });

	// 手机侧回调页面按 JSON 解析响应，已绑定身份返回 signed_in，不发验证码、不进注册流程。
	const phone = await app.request(`https://accounts.test/api/accounts/external/wechat?code=wechat-code&state=${encodeURIComponent(state)}&consume=1`);
	assert.equal(phone.status, 200);
	assert.equal(phone.headers.get('content-type')?.includes('application/json'), true, '手机回调页需要 JSON 响应');
	assert.deepEqual(await phone.json(), { status: 'signed_in' });

	// 电脑轮询拿到会话；二维码页可能开在业务站点的登录弹窗里，去向必须由后端给出，不能自己跳首页。
	// 该用户还没有设置密码，按规则先回登录页提示，补全后登录页才带 request_id 回授权端点。
	const polled = await app.request(`https://accounts.test${qr.pollUrl}`, { headers: { cookie: 'accounts_oidc_request=qr-request' } });
	const polledResult = await polled.json();
	assert.equal(polledResult.status, 'authenticated');
	assert.equal(polledResult.redirectTo, '/sign.html');
	const sessionCookie = setCookie(polled, 'passport_session');
	assert.ok(sessionCookie, '电脑端必须拿到 Accounts 会话');

	// 会话在页面上生效：头部是已登录身份，导航里有账户中心。
	const document = await (await app.request('https://accounts.test/', { headers: { accept: 'text/html', cookie: sessionCookie } })).text();
	const initialData = JSON.parse(document.match(/__INITIAL_DATA__=(\{.*?\});<\/script>/s)[1]);
	assert.equal(initialData.auth.currentUser?.username, '微信用户');
	assert.ok(initialData.siteNavigation.some((item) => item.label === '账户中心'));

	// 同一个二维码不能重复换会话。
	assert.deepEqual(await (await app.request(`https://accounts.test${qr.pollUrl}`)).json(), { status: 'consumed' });

	// 没有待授权请求时：还没设置密码就回登录页继续提示，设置过就回首页。
	const secondQr = await (await app.request('https://accounts.test/api/accounts/external/wechat?format=json')).json();
	const secondState = new URL(secondQr.authorizationUrl).searchParams.get('state');
	await app.request(`https://accounts.test/api/accounts/external/wechat?code=wechat-code&state=${encodeURIComponent(secondState)}&consume=1`);
	const standalone = await (await app.request(`https://accounts.test${secondQr.pollUrl}`)).json();
	assert.deepEqual(standalone, { status: 'authenticated', redirectTo: '/sign.html' });

	const credentialDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	credentialDatabase.prepare('INSERT INTO passport_user_credentials (user_id,password,created_at) VALUES (?,?,?)').run(userId, '{"hash":"x","pattern":"LLLL"}', Date.now());
	credentialDatabase.close();
	const thirdQr = await (await app.request('https://accounts.test/api/accounts/external/wechat?format=json')).json();
	const thirdState = new URL(thirdQr.authorizationUrl).searchParams.get('state');
	await app.request(`https://accounts.test/api/accounts/external/wechat?code=wechat-code&state=${encodeURIComponent(thirdState)}&consume=1`);
	assert.deepEqual(await (await app.request(`https://accounts.test${thirdQr.pollUrl}`)).json(), { status: 'authenticated', redirectTo: '/' });

	// 补全完成后带待授权请求登录，才会继续 OIDC 授权并清掉待授权 cookie。
	const fourthQr = await (await app.request('https://accounts.test/api/accounts/external/wechat?format=json')).json();
	const fourthState = new URL(fourthQr.authorizationUrl).searchParams.get('state');
	await app.request(`https://accounts.test/api/accounts/external/wechat?code=wechat-code&state=${encodeURIComponent(fourthState)}&consume=1`);
	const continued = await app.request(`https://accounts.test${fourthQr.pollUrl}`, { headers: { cookie: 'accounts_oidc_request=qr-request' } });
	assert.deepEqual(await continued.json(), { status: 'authenticated', redirectTo: '/api/oidc/authorize?request_id=qr-request' });
	assert.ok(continued.headers.getSetCookie().some((value) => value.startsWith('accounts_oidc_request=;')), '继续授权后要清掉待授权 cookie');

	// 二维码过期是正常轮询结果，必须是 200，否则页面会弹出"请求失败"。
	const expiredDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	expiredDatabase.prepare('UPDATE passport_external_login_states SET expires_at = ?').run(Date.now() - 1000);
	expiredDatabase.close();
	const expiredPoll = await app.request(`https://accounts.test${fourthQr.pollUrl}`);
	assert.equal(expiredPoll.status, 200);
	assert.deepEqual(await expiredPoll.json(), { status: 'expired' });


	const completed = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	assert.equal(completed.prepare('SELECT COUNT(*) AS count FROM passport_users').get().count, 1, '不应该重复创建用户');
	assert.equal(completed.prepare('SELECT COUNT(*) AS count FROM passport_external_pending_identities').get().count, 0, '已绑定身份不应该进入待注册状态');
	completed.close();

	console.log('wechat qr login test passed');
} finally {
	globalThis.fetch = originalFetch;
	await rm(temporaryDirectory, { recursive: true, force: true });
}
