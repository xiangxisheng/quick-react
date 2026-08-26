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

try {
	const { app } = await import(`../dist/server.mjs?accounts-oidc=${Date.now()}`);
	const database = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	const now = Date.now(), userId = 1000000000000000000n, sessionId = crypto.randomUUID();
	database.prepare(`INSERT INTO global_site_hosts (hostname, site_key, status, created_at) VALUES ('accounts.test', 'passport', 'enabled', ?)`).run(now);
	database.prepare(`INSERT INTO passport_users (user_id, nickname, status, created_at, updated_at) VALUES (?, 'AccountsUser', 'enabled', ?, ?)`).run(userId, now, now);
	database.prepare(`INSERT INTO passport_sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`).run(sessionId, userId, now + 3600_000, now);
	const clientId = 'acct_test', clientSecret = 'test-client-secret', verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
	const secretHash = Buffer.from(await sha256(clientSecret)).toString('hex'), challenge = base64Url(await sha256(verifier));
	database.prepare(`INSERT INTO passport_oidc_clients (id, name, secret_hash, redirect_uris, allowed_scopes, require_pkce, status, created_at, updated_at)
		VALUES (?, 'Test Client', ?, '["https://client.test/callback"]', 'openid profile email', 1, 'enabled', ?, ?)`).run(clientId, secretHash, now, now);
	database.close();
	const request = (path, options = {}) => app.request(`https://accounts.test${path}`, { method: options.method, headers: options.headers, body: options.body });
	const discovery = await (await request('/.well-known/openid-configuration')).json();
	assert.equal(discovery.issuer, 'https://accounts.test');
	assert.equal(discovery.authorization_endpoint, 'https://accounts.test/api/oidc/authorize');
	const authorize = new URL('/api/oidc/authorize', 'https://accounts.test');
	authorize.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: 'https://client.test/callback', scope: 'openid profile', state: 'state-1', nonce: 'nonce-1', code_challenge: challenge, code_challenge_method: 'S256' }).toString();
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
	console.log('accounts oidc test passed');
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
