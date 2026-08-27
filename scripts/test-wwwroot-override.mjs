import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// wwwroot/<hostname>/ 下的文件按域名覆盖应用页面。
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-wwwroot-'));
process.env.DEFAULT_DATABASE_FILE = join(temporaryDirectory, 'default.sqlite');
process.env.SKIP_SERVER_LISTEN = '1';

try {
	const { app } = await import(`../dist/server.mjs?wwwroot=${Date.now()}`);
	const html = (path, host = 'passport.firadio.com', method) => app.request(`http://${host}${path}`, { method, headers: { accept: 'text/html' } });

	// 该域名的首页由静态文件提供，不再是应用页面。
	const home = await html('/');
	assert.equal(home.status, 200);
	assert.match(home.headers.get('content-type') ?? '', /text\/html/);
	const homeBody = await home.text();
	assert.match(homeBody, /<h1>Firadio 账户中心<\/h1>/);
	assert.match(homeBody, /lh3\.googleusercontent\.com/);
	assert.match(homeBody, /\/page\/privacy\.html/);
	assert.equal(homeBody.includes('__INITIAL_DATA__'), false, '静态首页不应该再渲染应用');

	// 没有对应文件的路径仍然交给应用处理。
	const appPage = await html('/about.html');
	assert.equal(appPage.status, 200);
	assert.ok((await appPage.text()).includes('__INITIAL_DATA__'));

	// 其它域名不受影响。
	const otherHost = await html('/', 'localhost');
	assert.ok((await otherHost.text()).includes('__INITIAL_DATA__'));

	// 只覆盖 GET/HEAD，写操作不受影响。
	assert.equal((await html('/', 'passport.firadio.com', 'POST')).status, 404);

	// 目录穿越必须被拒绝。
	for (const path of ['/%2e%2e/package.json', '/%2e%2e%2f%2e%2e%2fpackage.json']) {
		const escaped = await html(path);
		assert.equal(escaped.status, 404, `不应该读到站点目录之外的文件：${path}`);
	}

	console.log('wwwroot override test passed');
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
