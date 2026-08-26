import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { oidcIssuer } from '@server/accounts/provider.mjs';
import { parseFormBody, randomToken, safeEqual, sha256, sha256Base64Url, signIdToken } from '@server/accounts/oidc.mjs';

type Code = { client_id: string; user_id: string; redirect_uri: string; scope: string; nonce: string; code_challenge: string; code_challenge_method: string; expires_at: number; consumed_at: number | null };
const handler: ApiHandler = async (c) => {
	if (c.get('site').siteKey !== 'passport' || c.req.method !== 'POST') return apiMessage(c, 404);
	const database = c.get('passportDatabase'); if (!database?.batch) return apiMessage(c, 503, 'Accounts 数据库不可用');
	const body = await parseFormBody(c.req.raw), authorization = c.req.header('authorization') ?? '';
	let clientId = String(body.client_id ?? ''), clientSecret = String(body.client_secret ?? '');
	if (authorization.startsWith('Basic ')) {
		try { [clientId, clientSecret] = atob(authorization.slice(6)).split(':', 2).map(decodeURIComponent); } catch { return apiMessage(c, 401, '客户端认证不合法'); }
	}
	const client = await database.prepare(`SELECT secret_hash, status FROM passport_oidc_clients WHERE id = ?1`).bind(clientId).first<{ secret_hash: string; status: string }>();
	if (!client || client.status !== 'enabled' || !safeEqual(client.secret_hash, await sha256(clientSecret))) return apiMessage(c, 401, '客户端认证失败');
	if (body.grant_type !== 'authorization_code') return apiMessage(c, 400, '仅支持 authorization_code');
	const rawCode = String(body.code ?? ''), code = await database.prepare(`SELECT client_id, CAST(user_id AS TEXT) AS user_id, redirect_uri, scope, nonce,
		code_challenge, code_challenge_method, expires_at, consumed_at FROM passport_oidc_authorization_codes WHERE code_hash = ?1`).bind(await sha256(rawCode)).first<Code>();
	if (!code || code.client_id !== clientId || code.redirect_uri !== String(body.redirect_uri ?? '') || code.consumed_at || code.expires_at <= Date.now()) return apiMessage(c, 400, '授权码无效、已使用或已过期');
	if (code.code_challenge && (code.code_challenge_method !== 'S256' || !safeEqual(code.code_challenge, await sha256Base64Url(String(body.code_verifier ?? ''))))) return apiMessage(c, 400, 'PKCE 校验失败');
	const user = await database.prepare(`SELECT CAST(u.user_id AS TEXT) AS sub, u.nickname AS name,
		(SELECT e.email FROM passport_user_emails ue JOIN passport_emails e ON e.id = ue.email_id WHERE ue.user_id = u.user_id AND ue.is_primary = 1 AND e.verified = 1 LIMIT 1) AS email
		FROM passport_users u WHERE u.user_id = ?1 AND u.status = 'enabled'`).bind(code.user_id).first<{ sub: string; name: string; email?: string }>();
	if (!user) return apiMessage(c, 400, 'Accounts 用户不存在或已停用');
	const accessToken = randomToken(32), now = Date.now(), expiresIn = 3600, issuer = oidcIssuer(c);
	await database.batch([
		{ query: 'UPDATE passport_oidc_authorization_codes SET consumed_at = ?2 WHERE code_hash = ?1 AND consumed_at IS NULL', values: [await sha256(rawCode), now] },
		{ query: `INSERT INTO passport_oidc_access_tokens (token_hash, client_id, user_id, scope, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`, values: [await sha256(accessToken), clientId, code.user_id, code.scope, now + expiresIn * 1000, now] },
	]);
	const idToken = await signIdToken(database, { iss: issuer, sub: user.sub, aud: clientId, exp: Math.floor(now / 1000) + expiresIn, iat: Math.floor(now / 1000), ...(code.nonce ? { nonce: code.nonce } : {}), name: user.name, ...(user.email ? { email: user.email, email_verified: true } : {}) });
	return apiResponse(c, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: expiresIn, scope: code.scope, id_token: idToken });
};
export default handler;
