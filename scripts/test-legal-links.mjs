import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Google 等身份源要求向用户提供公共隐私权政策和服务条款链接。
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-legal-links-'));
process.env.DEFAULT_DATABASE_FILE = join(temporaryDirectory, 'default.sqlite');
process.env.SKIP_SERVER_LISTEN = '1';

try {
	const { app } = await import(`../dist/server.mjs?legal-links=${Date.now()}`);
	const request = async (path, options = {}) => {
		const headers = new Headers(options.headers);
		if (options.cookie) headers.set('cookie', options.cookie);
		if (options.body !== undefined) headers.set('content-type', 'application/json');
		return app.request(`http://localhost${path}`, { method: options.method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
	};
	const initialData = async (cookie) => {
		const html = await (await request('/', { cookie, headers: { accept: 'text/html' } })).text();
		return JSON.parse(html.match(/__INITIAL_DATA__=(\{.*?\});<\/script>/s)[1]);
	};

	assert.equal((await request('/api/sign.php', { method: 'PUT', body: { username: 'legal_admin', password: 'test-password-123' } })).status, 201);
	const login = await request('/api/sign.php', { method: 'POST', body: { username: 'legal_admin', password: 'test-password-123' } });
	const cookie = login.headers.get('set-cookie')?.split(';')[0];
	const configPath = '/api/panel/admin/system/settings/system-config.php';

	// 默认没有配置时不下发链接，页面也不展示。
	assert.equal((await initialData()).legalLinks, undefined);
	const form = await (await request(configPath, { cookie })).json();
	assert.deepEqual(form.formPage.fields.filter((field) => field.name.endsWith('Url')).map((field) => field.name), ['privacyPolicyUrl', 'termsOfServiceUrl']);

	// 非法地址按未配置处理，不会把用户带到不可用的链接。
	const rejected = await request(configPath, { method: 'PUT', cookie, body: { privacyPolicyUrl: 'javascript:alert(1)', termsOfServiceUrl: 'example.com/terms', __changedFields: ['privacyPolicyUrl', 'termsOfServiceUrl'] } });
	assert.equal(rejected.status, 200);
	const rejectedValues = (await rejected.json()).currentValues;
	assert.equal(rejectedValues.privacyPolicyUrl, '');
	assert.equal(rejectedValues.termsOfServiceUrl, '');

	// 配置后全站可见，登录页同样能看到。
	const saved = await request(configPath, { method: 'PUT', cookie, body: { privacyPolicyUrl: 'https://example.com/privacy', termsOfServiceUrl: 'https://example.com/terms', __changedFields: ['privacyPolicyUrl', 'termsOfServiceUrl'] } });
	assert.equal(saved.status, 200);
	const homeData = await initialData();
	assert.deepEqual(homeData.legalLinks, [
		{ key: 'privacy', label: '隐私权政策', url: 'https://example.com/privacy' },
		{ key: 'terms', label: '服务条款', url: 'https://example.com/terms' },
	]);
	const signHtml = await (await request('/sign.html', { headers: { accept: 'text/html' } })).text();
	const signData = JSON.parse(signHtml.match(/__INITIAL_DATA__=(\{.*?\});<\/script>/s)[1]);
	assert.deepEqual(signData.legalLinks?.map((link) => link.key), ['privacy', 'terms']);

	// 只配置一个时只下发一个。
	await request(configPath, { method: 'PUT', cookie, body: { termsOfServiceUrl: '', __changedFields: ['termsOfServiceUrl'] } });
	assert.deepEqual((await initialData()).legalLinks?.map((link) => link.key), ['privacy']);

	console.log('legal links test passed');
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
