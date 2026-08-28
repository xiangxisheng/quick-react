import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

// Google 登录时把头像异步同步到对象存储。
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-avatar-'));
process.env.DEFAULT_DATABASE_FILE = join(temporaryDirectory, 'default.sqlite');
process.env.SKIP_SERVER_LISTEN = '1';
const originalFetch = globalThis.fetch;
const uploads = [];
let listCalls = 0;
let storedKey = '';

globalThis.fetch = async (input, init) => {
	const url = new URL(String(input));
	if (url.href === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'google-token' });
	if (url.href === 'https://openidconnect.googleapis.com/v1/userinfo') {
		return Response.json({ sub: 'google-avatar-1', name: '头像用户', email: 'avatar@example.com', email_verified: true, picture: 'https://lh3.googleusercontent.com/avatar-image' });
	}
	if (url.href === 'https://lh3.googleusercontent.com/avatar-image') {
		return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'image/png' } });
	}
	// 对象存储：列举返回是否已存在，PUT 记录上传。
	if (url.hostname === 'storage.test') {
		if (init?.method === 'PUT') {
			uploads.push({ path: url.pathname, contentType: new Headers(init.headers).get('content-type'), size: init.body?.byteLength ?? 0 });
			storedKey = url.pathname.replace('/media/', '');
			return new Response('', { status: 200 });
		}
		listCalls += 1;
		const contents = storedKey
			? `<ListBucketResult><Contents><Key>${storedKey}</Key><Size>4</Size><LastModified>2026-08-28T00:00:00Z</LastModified></Contents></ListBucketResult>`
			: '<ListBucketResult></ListBucketResult>';
		return new Response(contents, { headers: { 'content-type': 'application/xml' } });
	}
	return originalFetch(input, init);
};

try {
	const { app } = await import(`../dist/server.mjs?avatar=${Date.now()}`);
	const database = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	const now = Date.now();
	database.prepare("INSERT INTO global_site_hosts (hostname, site_key, status, created_at) VALUES ('accounts.test','passport','enabled',?)").run(now);
	database.prepare("INSERT INTO passport_external_providers (id,display_name,client_id,client_secret,status,created_at,updated_at) VALUES ('google','Google','gid','gsecret','enabled',?,?)").run(now, now);
	database.prepare(`INSERT INTO global_cloud_credentials (id,name,provider,access_key_id,access_key_secret,status,created_at,updated_at)
		VALUES (31,'avatar-store','other','key','secret','enabled',?,?)`).run(now, now);
	database.prepare(`INSERT INTO global_cloud_object_storage_buckets (id,cloud_credential_id,bucket,endpoint,region,path_style,status,created_at,updated_at)
		VALUES (32,31,'media','https://storage.test','auto',1,'enabled',?,?)`).run(now, now);
	database.prepare(`INSERT INTO global_cloud_object_storage_bindings (id,site_key,bucket_id,key_prefix,status,created_at,updated_at)
		VALUES (33,'passport',32,'','enabled',?,?)`).run(now, now);
	database.prepare("INSERT INTO global_cloud_object_storage_binding_purposes (binding_id,site_key,purpose,is_default) VALUES (33,'passport','avatars',1)").run();
	database.close();

	// Google 登录：新用户直接建号，并触发头像同步。
	const start = await app.request('https://accounts.test/api/accounts/external/google');
	const state = new URL(start.headers.get('location')).searchParams.get('state');
	const stateCookie = start.headers.getSetCookie().map((value) => value.split(';')[0]).find((value) => value.startsWith('accounts_external_state='));
	const callback = await app.request(`https://accounts.test/api/accounts/external/google?code=code&state=${encodeURIComponent(state)}`, { headers: { cookie: stateCookie } });
	assert.equal(callback.status, 302);

	await new Promise((resolve) => setTimeout(resolve, 80));
	assert.equal(uploads.length, 1, '应该上传一次头像');
	const stored = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	const userId = stored.prepare('SELECT CAST(user_id AS TEXT) AS user_id FROM passport_users').get().user_id;
	stored.close();
	assert.equal(uploads[0].path, `/media/avatars/${userId}`, '路径由 user_id 推导');
	assert.equal(uploads[0].contentType, 'image/png');
	assert.equal(uploads[0].size, 4);

	// 再登录一次：头像已存在就不再下载上传。
	const again = await app.request('https://accounts.test/api/accounts/external/google');
	const againState = new URL(again.headers.get('location')).searchParams.get('state');
	const againCookie = again.headers.getSetCookie().map((value) => value.split(';')[0]).find((value) => value.startsWith('accounts_external_state='));
	await app.request(`https://accounts.test/api/accounts/external/google?code=code&state=${encodeURIComponent(againState)}`, { headers: { cookie: againCookie } });
	await new Promise((resolve) => setTimeout(resolve, 80));
	assert.equal(uploads.length, 1, '已有头像不应该重复上传');

	console.log('accounts avatar test passed');
} finally {
	globalThis.fetch = originalFetch;
	await rm(temporaryDirectory, { recursive: true, force: true });
}
