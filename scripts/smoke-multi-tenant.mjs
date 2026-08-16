import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-smoke-'));
process.env.DEFAULT_DATABASE_FILE = join(temporaryDirectory, 'default.sqlite');
process.env.SKIP_SERVER_LISTEN = '1';

try {
	const { app } = await import(`../dist/server.mjs?smoke=${Date.now()}`);
	const request = async (host, path, options = {}) => {
		const headers = new Headers(options.headers);
		if (options.cookie) headers.set('cookie', options.cookie);
		if (options.body !== undefined) headers.set('content-type', 'application/json');
		return app.request(`http://${host}${path}`, {
			method: options.method,
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
	};

	assert.equal((await request('localhost', '/api/health.php')).status, 200);
	assert.equal((await request('localhost', '/api/panel/admin/sites.php')).status, 401);
	const registration = await request('localhost', '/api/sign.php');
	assert.deepEqual(await registration.json(), { user: null, registrationAvailable: true });
	assert.equal((await request('localhost', '/api/sign.php', {
		method: 'PUT', body: { username: 'bootstrap_admin', password: 'test-password-123' },
	})).status, 201);
	const login = await request('localhost', '/api/sign.php', {
		method: 'POST', body: { username: 'bootstrap_admin', password: 'test-password-123' },
	});
	assert.equal(login.status, 200);
	const cookie = login.headers.get('set-cookie')?.split(';')[0];
	assert.ok(cookie);

	const createSite = async (siteKey, extra = {}) => {
		assert.equal((await request('localhost', '/api/panel/admin/sites.php', {
			method: 'POST', cookie, body: { site_key: siteKey, name: siteKey, ...extra },
		})).status, 201);
		assert.equal((await request('localhost', `/api/panel/admin/sites.php/${siteKey}`, {
			method: 'POST', cookie,
		})).status, 200);
		assert.equal((await request('localhost', `/api/panel/admin/sites.php/${siteKey}`, {
			method: 'PUT', cookie, body: { status: 'enabled' },
		})).status, 200);
	};

	await createSite('site1');
	for (const hostname of ['site1.test', '*.wild.test']) {
		assert.equal((await request('localhost', '/api/panel/admin/hosts.php', {
			method: 'POST', cookie, body: { hostname, site_key: 'site1' },
		})).status, 201);
	}
	assert.equal((await request('site1.test', '/api/health.php')).status, 200);
	assert.equal((await request('site1.test', '/api/panel/admin/sites.php', { cookie })).status, 404);
	assert.equal((await request('a.wild.test', '/api/panel/admin/sites.php', { cookie })).status, 404);
	assert.equal((await request('a.b.wild.test', '/api/panel/admin/sites.php', { cookie })).status, 200);

	await createSite('site2', { dsn: `sqlite://${join(temporaryDirectory, 'site2.sqlite')}` });
	assert.equal((await request('localhost', '/api/panel/admin/hosts.php', {
		method: 'POST', cookie, body: { hostname: 'site2.test', site_key: 'site2' },
	})).status, 201);
	const isolatedRegistration = await request('site2.test', '/api/sign.php');
	assert.deepEqual(await isolatedRegistration.json(), { user: null, registrationAvailable: true });

	const publicDocument = await (await request('localhost', '/')).text();
	assert.equal(publicDocument.includes('站点管理'), false);
	const adminDocument = await (await request('localhost', '/', { cookie })).text();
	assert.equal(adminDocument.includes('站点管理'), true);
	console.log('multi-tenant smoke test passed');
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
