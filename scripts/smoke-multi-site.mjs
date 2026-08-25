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
	assert.equal((await request('localhost', '/api/panel/admin/global/site/sites.php')).status, 401);
	const registration = await request('localhost', '/api/sign.php');
	const registrationFormResult = await registration.json();
	assert.equal(registrationFormResult.user, null);
	assert.equal(registrationFormResult.registrationAvailable, true);
	assert.ok(registrationFormResult.formPage);
	const registrationResponse = await request('localhost', '/api/sign.php', {
		method: 'PUT', body: { username: 'bootstrap_admin', password: 'test-password-123' },
	});
	assert.equal(registrationResponse.status, 201);
	const registrationResult = await registrationResponse.json();
	assert.ok(registrationResult.feedback);
	assert.equal(Object.hasOwn(registrationResult, 'message'), false);
	const login = await request('localhost', '/api/sign.php', {
		method: 'POST', body: { username: 'bootstrap_admin', password: 'test-password-123' },
	});
	assert.equal(login.status, 200);
	const loginResult = await login.json();
	assert.equal(loginResult.feedback.message, '登录成功');
	assert.equal(Object.hasOwn(loginResult, 'message'), false);
	const cookie = login.headers.get('set-cookie')?.split(';')[0];
	assert.ok(cookie);
	const invalidLogin = await request('localhost', '/api/sign.php', {
		method: 'POST', body: { username: 'bootstrap_admin', password: 'wrong-password' },
	});
	assert.equal(invalidLogin.status, 401);
	const invalidLoginResult = await invalidLogin.json();
	assert.equal(invalidLoginResult.feedback.message, '用户名或密码错误');
	assert.equal(invalidLoginResult.feedback.component, 'modal');
	assert.equal(invalidLoginResult.feedback.type, 'error');
	const missingApi = await request('localhost', '/api/not-found');
	assert.equal(missingApi.status, 404);
	const missingApiResult = await missingApi.json();
	assert.equal(missingApiResult.feedback.component, 'modal');
	assert.equal(missingApiResult.feedback.type, 'error');
	assert.equal(missingApiResult.feedback.message, '请求的资源不存在');

	const createSite = async (siteKey, extra = {}) => {
		assert.equal((await request('localhost', '/api/panel/admin/global/site/sites.php', {
			method: 'POST', cookie, body: { site_key: siteKey, name: siteKey, ...extra },
		})).status, 201);
		assert.equal((await request('localhost', `/api/panel/admin/global/site/sites.php/${siteKey}`, {
			method: 'POST', cookie,
		})).status, 200);
		assert.equal((await request('localhost', `/api/panel/admin/global/site/sites.php/${siteKey}`, {
			method: 'PUT', cookie, body: { status: 'enabled' },
		})).status, 200);
	};

	await createSite('site1');
	for (const hostname of ['site1.test', '*.wild.test']) {
		assert.equal((await request('localhost', '/api/panel/admin/global/site/hosts.php', {
			method: 'POST', cookie, body: { hostname, site_key: 'site1' },
		})).status, 201);
	}
	assert.equal((await request('site1.test', '/api/health.php')).status, 200);
	assert.equal((await request('site1.test', '/api/panel/admin/global/site/sites.php', { cookie })).status, 404);
	assert.equal((await request('a.wild.test', '/api/panel/admin/global/site/sites.php', { cookie })).status, 404);
	assert.equal((await request('a.b.wild.test', '/api/panel/admin/global/site/sites.php', { cookie })).status, 200);

	await createSite('site2', { dsn: `sqlite://${join(temporaryDirectory, 'site2.sqlite')}` });
	assert.equal((await request('localhost', '/api/panel/admin/global/site/hosts.php', {
		method: 'POST', cookie, body: { hostname: 'site2.test', site_key: 'site2' },
	})).status, 201);
	const isolatedRegistration = await request('site2.test', '/api/sign.php');
	const isolatedRegistrationResult = await isolatedRegistration.json();
	assert.equal(isolatedRegistrationResult.user, null);
	assert.equal(isolatedRegistrationResult.registrationAvailable, true);
	assert.ok(isolatedRegistrationResult.formPage);

	const credentialsPath = '/api/panel/admin/global/cloud/credentials.php';
	assert.equal((await request('localhost', credentialsPath, {
		method: 'POST', cookie, body: { name: 'smoke-s3', provider: 'other', access_key_id: 'smoke-key', access_key_secret: 'smoke-secret' },
	})).status, 201);
	const credentialsResult = await (await request('localhost', credentialsPath, { cookie })).json();
	const credential = credentialsResult.table.dataSource.find((item) => item.name === 'smoke-s3');
	assert.ok(credential?.id);
	assert.equal(Object.hasOwn(credential, 'access_key_secret'), false);
	const credentialDetail = await (await request('localhost', `${credentialsPath}/${credential.id}`, { cookie })).json();
	assert.equal(Object.hasOwn(credentialDetail, 'access_key_secret'), false);
	const credentialTest = await request('localhost', `${credentialsPath}/${credential.id}?action=test`, { method: 'POST', cookie });
	assert.equal(credentialTest.status, 200);
	assert.equal((await credentialTest.json()).feedback.message, '该自定义凭据暂不支持独立测试，请在 Bucket 配置中测试');

	const bucketsPath = '/api/panel/admin/global/cloud/object-storage/buckets.php';
	const discoveredBuckets = await (await request('localhost', `${bucketsPath}?action=discover&field=bucket&cloud_credential_id=${credential.id}`, { cookie })).json();
	assert.deepEqual(discoveredBuckets.options, []);
	assert.equal((await request('localhost', bucketsPath, {
		method: 'POST', cookie, body: { cloud_credential_id: credential.id, endpoint: 'https://s3.example.invalid', region: 'us-east-1', bucket: 'smoke-bucket', path_style: true },
	})).status, 201);
	const bucketsResult = await (await request('localhost', bucketsPath, { cookie })).json();
	const bucket = bucketsResult.table.dataSource.find((item) => item.bucket === 'smoke-bucket');
	assert.ok(bucket?.id);

	const bindingsPath = '/api/panel/admin/global/cloud/object-storage/bindings.php';
	assert.equal((await request('localhost', bindingsPath, {
		method: 'POST', cookie, body: { site_key: 'site1', bucket_id: bucket.id, purposes: ['uploads', 'attachments'], default_purposes: ['uploads'] },
	})).status, 201);
	const bindingsResult = await (await request('localhost', bindingsPath, { cookie })).json();
	assert.equal(bindingsResult.table.dataSource.length, 1);
	assert.deepEqual(bindingsResult.table.dataSource[0].purposes.sort(), ['attachments', 'uploads']);
	assert.deepEqual(bindingsResult.table.dataSource[0].default_purposes, ['uploads']);
	assert.equal((await request('localhost', '/api/panel/admin/global/cloud/object-storage/objects.php', { cookie })).status, 200);

	const publicDocument = await (await request('localhost', '/')).text();
	assert.equal(publicDocument.includes('站点管理'), false);
	const adminDocument = await (await request('localhost', '/', { cookie })).text();
	assert.equal(adminDocument.includes('站点管理'), true);
	console.log('multi-site smoke test passed');
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
