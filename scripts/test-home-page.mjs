import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

// 首页必须公开说明应用用途：外部身份源（Google 等）在应用验证时会检查这一点。
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-home-page-'));
process.env.DEFAULT_DATABASE_FILE = join(temporaryDirectory, 'default.sqlite');
process.env.SKIP_SERVER_LISTEN = '1';

try {
	const { app } = await import(`../dist/server.mjs?home-page=${Date.now()}`);
	const database = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	database.prepare("INSERT INTO global_site_hosts (hostname, site_key, status, created_at) VALUES ('accounts.test','passport','enabled',?)").run(Date.now());
	database.close();

	// 站点首页说明由后端下发，未登录也能读取。
	const base = await (await app.request('http://localhost/api/home.php')).json();
	assert.ok(base.home.summary.length > 10);
	assert.deepEqual(base.home.links.map((link) => link.url), ['/page/privacy.html', '/page/terms.html']);

	// Accounts 站点覆盖成账号服务的用途说明，覆盖登录方式、账号管理、统一登录和数据使用。
	const accounts = await (await app.request('http://accounts.test/api/home.php')).json();
	// 首页显示的应用名称必须唯一且等于站点名称，Google 同意屏幕要配置同一个名字。
	const accountsDocument = await (await app.request('http://accounts.test/', { headers: { accept: 'text/html' } })).text();
	const accountsSiteName = JSON.parse(accountsDocument.match(/__INITIAL_DATA__=(\{.*?\});<\/script>/s)[1]).siteName;
	assert.equal(accounts.home.title, accountsSiteName);
	assert.match(accountsDocument, new RegExp(`<noscript>\\s*<h1>${accountsSiteName}</h1>`));
	assert.match(accounts.home.summary, /统一账号服务/);
	assert.deepEqual(accounts.home.sections.map((section) => section.key), ['sign-in', 'account', 'sso', 'privacy', 'contact']);
	assert.match(accounts.home.sections.find((section) => section.key === 'privacy').body, /Google API 服务用户数据政策/);
	assert.match(accounts.home.sections.find((section) => section.key === 'contact').body, /xiangxisheng@gmail\.com/);

	// 首页给出登录入口，指向账号登录页（第三方登录都在那里），而不是站点本地账号密码页。
	assert.deepEqual(accounts.home.links.map((link) => [link.key, link.url]), [
		['sign-in', '/accounts/sign.html'],
		['privacy', '/page/privacy.html'],
		['terms', '/page/terms.html'],
	]);
	// 初始管理员还没创建时，任何站点都给出创建入口，这条规则对所有站点一致。
	const accountsAuth = JSON.parse(accountsDocument.match(/__INITIAL_DATA__=(\{.*?\});<\/script>/s)[1]).auth;
	assert.deepEqual(accountsAuth.actions.map((action) => [action.key, action.action]), [['/accounts/sign', 'navigate'], ['/sign-up', 'navigate']]);
	// 建好初始管理员后入口消失：判断依据是本站数据库的引导状态，不是站点标识。
	assert.equal((await app.request('http://localhost/api/sign.php', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'home_admin', password: 'test-password-123' }) })).status, 201);
	const claimedDocument = await (await app.request('http://accounts.test/', { headers: { accept: 'text/html' } })).text();
	const claimedAuth = JSON.parse(claimedDocument.match(/__INITIAL_DATA__=(\{.*?\});<\/script>/s)[1]).auth;
	assert.deepEqual(claimedAuth.actions.map((action) => [action.key, action.action]), [['/accounts/sign', 'navigate']]);

	// 不执行脚本时也能读到用途说明和隐私政策链接。
	const html = await (await app.request('http://accounts.test/', { headers: { accept: 'text/html' } })).text();
	assert.match(html, /<meta name="description" content="统一账号服务：/);
	assert.match(html, /<noscript>[\s\S]*统一账号服务[\s\S]*<\/noscript>/);
	assert.match(html, /<noscript>[\s\S]*\/page\/privacy\.html[\s\S]*<\/noscript>/);

	// 首页不需要登录即可访问。
	const anonymous = await app.request('http://accounts.test/', { headers: { accept: 'text/html' } });
	assert.equal(anonymous.status, 200);

	console.log('home page test passed');
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
