import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-page-status-'));
process.env.DEFAULT_DATABASE_FILE = join(temporaryDirectory, 'default.sqlite');
process.env.SKIP_SERVER_LISTEN = '1';

try {
	const { app } = await import(`../dist/server.mjs?page-status=${Date.now()}`);
	const request = async (path, options = {}) => {
		const headers = new Headers(options.headers);
		if (options.cookie) headers.set('cookie', options.cookie);
		if (options.body !== undefined) headers.set('content-type', 'application/json');
		return app.request(`http://localhost${path}`, {
			method: options.method,
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
			redirect: 'manual',
		});
	};
	const document = async (path, options = {}) => {
		const response = await request(path, { ...options, headers: { ...options.headers, accept: 'text/html' } });
		const body = response.status === 302 ? '' : await response.text();
		const initialData = body.match(/__INITIAL_DATA__=(\{.*?\});<\/script>/s);
		return { response, body, pageStatus: initialData ? JSON.parse(initialData[1]).pageStatus : undefined };
	};

	// 未登录访问不存在的路径。
	const missing = await document('/no-such-page.html');
	assert.equal(missing.response.status, 404);
	assert.equal(missing.pageStatus.status, 404);
	assert.equal(missing.pageStatus.title, '页面不存在');
	assert.match(missing.body, /页面不存在/);

	// 未登录访问需要登录的路径。
	const anonymousPanel = await document('/panel/admin.html');
	assert.equal(anonymousPanel.response.status, 401);
	assert.equal(anonymousPanel.pageStatus.title, '请先登录');
	assert.deepEqual(anonymousPanel.pageStatus.actions.map((action) => action.key), ['/sign', '/']);

	// 公开页面正常渲染，不返回状态提示。
	const about = await document('/about.html');
	assert.equal(about.response.status, 200);
	assert.equal(about.pageStatus, undefined);

	// 缺少页面后缀的合法路径跳转到规范地址。
	const withoutSuffix = await document('/about?from=test');
	assert.equal(withoutSuffix.response.status, 302);
	assert.equal(new URL(withoutSuffix.response.headers.get('location')).pathname, '/about.html');
	assert.equal(new URL(withoutSuffix.response.headers.get('location')).search, '?from=test');

	// JSON 接口给出同样的提示，供前端路由兜底使用。
	const anonymousStatus = await (await request('/api/page-status.php?path=/panel/admin')).json();
	assert.equal(anonymousStatus.pageStatus.status, 401);
	const unknownStatus = await (await request('/api/page-status.php?path=/no-such-page')).json();
	assert.equal(unknownStatus.pageStatus.status, 404);
	const allowedStatus = await (await request('/api/page-status.php?path=/about')).json();
	assert.equal(allowedStatus.pageStatus.status, 500);
	assert.equal(allowedStatus.pageStatus.title, '页面暂不可用');

	assert.equal((await request('/api/sign.php', { method: 'PUT', body: { username: 'page_admin', password: 'test-password-123' } })).status, 201);
	const adminLogin = await request('/api/sign.php', { method: 'POST', body: { username: 'page_admin', password: 'test-password-123' } });
	const adminCookie = adminLogin.headers.get('set-cookie')?.split(';')[0];
	assert.ok(adminCookie);

	// 管理员可以正常打开管理后台。
	const adminPanel = await document('/panel/admin.html', { cookie: adminCookie });
	assert.equal(adminPanel.response.status, 200);
	assert.equal(adminPanel.pageStatus, undefined);

	assert.equal((await request('/api/panel/admin/system/users.php', {
		method: 'POST', cookie: adminCookie, body: { username: 'page_user', password: 'test-password-123', roles: '["user"]', status: 'enabled' },
	})).status, 201);
	const userLogin = await request('/api/sign.php', { method: 'POST', body: { username: 'page_user', password: 'test-password-123' } });
	const userCookie = userLogin.headers.get('set-cookie')?.split(';')[0];
	assert.ok(userCookie);

	// 已登录但角色不足。
	const forbidden = await document('/panel/admin.html', { cookie: userCookie });
	assert.equal(forbidden.response.status, 403);
	assert.equal(forbidden.pageStatus.title, '无权访问');
	assert.match(forbidden.pageStatus.description, /page_user/);
	const forbiddenStatus = await (await request('/api/page-status.php?path=/panel/admin', { cookie: userCookie })).json();
	assert.equal(forbiddenStatus.pageStatus.status, 403);

	// 已登录用户访问不存在的路径仍然是 404。
	const userMissing = await document('/panel/admin/nope.html', { cookie: userCookie });
	assert.equal(userMissing.response.status, 404);
	assert.equal(userMissing.pageStatus.status, 404);

	// 个人中心对普通用户开放。
	const personal = await document('/panel/me.html', { cookie: userCookie });
	assert.equal(personal.response.status, 200);
	assert.equal(personal.pageStatus, undefined);

	console.log('page status test passed');
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
