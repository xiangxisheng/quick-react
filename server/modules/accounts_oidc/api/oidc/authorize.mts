import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage } from '@server/api-response.mjs';
import { loadPassportSession } from '@server/passport/session.mjs';
import { oidcRequestCookie, randomToken, sha256 } from '@server/accounts/oidc.mjs';

type Client = { id: string; redirect_uris: string; allowed_scopes: string; require_pkce: number; status: string };
type RequestRow = { client_id: string; redirect_uri: string; scope: string; state: string; nonce: string; code_challenge: string; code_challenge_method: string; expires_at: number };

const handler: ApiHandler = async (c) => {
	if (c.get('site').siteKey !== 'passport' || c.req.method !== 'GET') return apiMessage(c, 404);
	const database = c.get('passportDatabase');
	if (!database) return apiMessage(c, 503, 'Accounts 数据库不可用');
	let values: RequestRow;
	const requestId = c.req.query('request_id')?.trim();
	if (requestId) {
		const stored = await database.prepare(`SELECT client_id, redirect_uri, scope, state, nonce, code_challenge, code_challenge_method, expires_at
			FROM passport_oidc_authorization_requests WHERE id = ?1`).bind(requestId).first<RequestRow>();
		if (!stored || stored.expires_at <= Date.now()) return apiMessage(c, 400, 'OIDC 授权请求不存在或已过期');
		values = stored;
	} else {
		if (c.req.query('response_type') !== 'code') return apiMessage(c, 400, '仅支持 response_type=code');
		values = {
			client_id: c.req.query('client_id')?.trim() ?? '', redirect_uri: c.req.query('redirect_uri')?.trim() ?? '',
			scope: c.req.query('scope')?.trim() ?? '', state: c.req.query('state') ?? '', nonce: c.req.query('nonce') ?? '',
			code_challenge: c.req.query('code_challenge')?.trim() ?? '', code_challenge_method: c.req.query('code_challenge_method')?.trim() ?? '', expires_at: Date.now() + 600_000,
		};
	}
	const client = await database.prepare(`SELECT id, redirect_uris, allowed_scopes, require_pkce, status FROM passport_oidc_clients WHERE id = ?1`).bind(values.client_id).first<Client>();
	if (!client || client.status !== 'enabled') return apiMessage(c, 400, 'OIDC 客户端不存在或已停用');
	if (!(JSON.parse(client.redirect_uris) as string[]).includes(values.redirect_uri)) return apiMessage(c, 400, 'redirect_uri 未注册');
	const scopes = [...new Set(values.scope.split(/\s+/).filter(Boolean))];
	const allowed = new Set(client.allowed_scopes.split(/\s+/));
	if (!scopes.includes('openid') || scopes.some((scope) => !allowed.has(scope))) return apiMessage(c, 400, '请求的 scope 不被允许');
	if (client.require_pkce && (!/^[A-Za-z0-9_-]{43,128}$/.test(values.code_challenge) || values.code_challenge_method !== 'S256')) return apiMessage(c, 400, '该客户端要求 PKCE S256');
	const current = await loadPassportSession(database, c.req.raw);
	if (!current) {
		const id = requestId || crypto.randomUUID(), now = Date.now();
		if (!requestId) await database.prepare(`INSERT INTO passport_oidc_authorization_requests
			(id, client_id, redirect_uri, scope, state, nonce, code_challenge, code_challenge_method, expires_at, created_at)
			VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`).bind(id, values.client_id, values.redirect_uri, scopes.join(' '), values.state, values.nonce, values.code_challenge, values.code_challenge_method, now + 600_000, now).run();
		c.header('Set-Cookie', oidcRequestCookie(id, new URL(c.req.url).protocol === 'https:'));
		return c.redirect(`/passport/sso/sign${c.get('techStackConfig').pageSuffix}`, 302);
	}
	const code = randomToken(32), now = Date.now();
	await database.prepare(`INSERT INTO passport_oidc_authorization_codes
		(code_hash, client_id, user_id, redirect_uri, scope, nonce, code_challenge, code_challenge_method, expires_at, created_at)
		VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`).bind(await sha256(code), values.client_id, String(current.id), values.redirect_uri, scopes.join(' '), values.nonce, values.code_challenge, values.code_challenge_method, now + 60_000, now).run();
	if (requestId) await database.prepare('DELETE FROM passport_oidc_authorization_requests WHERE id = ?1').bind(requestId).run();
	const redirect = new URL(values.redirect_uri); redirect.searchParams.set('code', code); if (values.state) redirect.searchParams.set('state', values.state);
	return c.redirect(redirect.toString(), 302);
};

export default handler;
