import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 未启用 Accounts 登录的站点，任何入口都不得走 Accounts 验证。
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-login-disabled-'));
process.env.DEFAULT_DATABASE_FILE = join(temporaryDirectory, 'default.sqlite');
process.env.SKIP_SERVER_LISTEN = '1';

try {
	const { app } = await import(`../dist/server.mjs?login-disabled=${Date.now()}`);
	const request = (path, options = {}) => app.request(`http://localhost${path}`, {
		method: options.method,
		headers: { ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...options.headers },
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const initialData = async (path) => {
		const html = await (await request(path, { headers: { accept: 'text/html' } })).text();
		return JSON.parse(html.match(/__INITIAL_DATA__=(\{.*?\});<\/script>/s)[1]);
	};

	// 头部登录按钮跳本站登录页，不弹 Accounts 登录窗口。
	const home = await initialData('/');
	assert.deepEqual(home.auth.actions.map((action) => [action.key, action.action]), [['/sign', 'navigate'], ['/sign-up', 'navigate']]);

	// 需要登录的页面提示同样走本站登录页。
	const blocked = await initialData('/panel/admin.html');
	assert.equal(blocked.pageStatus.status, 401);
	assert.deepEqual(blocked.pageStatus.actions.map((action) => action.action), ['navigate', 'navigate']);

	// 登录页是本站账号密码表单，不下发 Accounts 登录入口。
	const signForm = await (await request('/api/sign.php')).json();
	assert.equal(signForm.formPage.passportLogin, undefined);
	assert.deepEqual(signForm.formPage.fields.map((field) => field.name), ['username', 'password', 'remember']);

	// 误触发的 SDK 登录请求要给出明确提示，不能落到本地密码登录报"用户名或密码错误"。
	const sdkLogin = await request('/api/sign.php', { method: 'POST', body: { action: 'login' } });
	assert.equal(sdkLogin.status, 409);
	assert.match((await sdkLogin.json()).feedback.message, /未启用 Accounts 登录/);

	// 本站账号密码登录不受影响。
	assert.equal((await request('/api/sign.php', { method: 'PUT', body: { username: 'local_admin', password: 'test-password-123' } })).status, 201);
	const login = await request('/api/sign.php', { method: 'POST', body: { username: 'local_admin', password: 'test-password-123' } });
	assert.equal(login.status, 200);
	assert.ok(login.headers.get('set-cookie'));

	// 身份中心站点和业务站点用同一套模块：后台同样有“Accounts 登录”设置页，可以在这里关掉这种登录方式。
	const cookie = login.headers.get('set-cookie').split(';')[0];
	assert.equal((await request('/api/panel/admin/global/site/hosts.php', { method: 'POST', headers: { cookie }, body: { hostname: 'accounts.test', site_key: 'passport' } })).status, 201);
	const settingsPath = '/api/panel/admin/system/settings/accounts-oidc.php';
	assert.equal((await app.request(`http://accounts.test${settingsPath}`, { headers: { cookie } })).status, 200);
	const passportPanel = await (await app.request('http://accounts.test/panel/admin.html', { headers: { accept: 'text/html', cookie } })).text();
	const passportInitial = JSON.parse(passportPanel.match(/__INITIAL_DATA__=(\{.*?\});<\/script>/s)[1]);
	const navigationKeys = (items) => items.flatMap((item) => [String(item.key), ...navigationKeys(item.children ?? [])]);
	assert.ok(navigationKeys(passportInitial.siteNavigation).includes('/panel/admin/system/settings/accounts-oidc'));

	console.log('accounts login disabled test passed');
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
