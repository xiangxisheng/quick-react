import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { oidcIssuer } from '@server/accounts/provider.mjs';
import { parseFormBody, randomToken, safeEqual, sha256, sha256Base64Url, signIdToken } from '@server/accounts/oidc.mjs';
import { accountUser, authorizationCode, oidcClient } from '@server/accounts/repository.mjs';
import { sql } from '@server/database/sql.mjs';

type Code = { client_id: string; user_id: string; redirect_uri: string; scope: string; nonce: string; code_challenge: string; code_challenge_method: string; expires_at: number; consumed_at: number | null; session_id: string };
const handler: ApiHandler = async (c) => {
	if (c.get('site').siteKey !== 'passport' || c.req.method !== 'POST') return apiMessage(c, 404);
	const database = c.get('passportDatabase'); if (!database?.batch) return apiMessage(c, 503, 'Accounts 数据库不可用');
	const body = await parseFormBody(c.req.raw), authorization = c.req.header('authorization') ?? '';
	let clientId = String(body.client_id ?? ''), clientSecret = String(body.client_secret ?? '');
	if (authorization.startsWith('Basic ')) {
		try { [clientId, clientSecret] = atob(authorization.slice(6)).split(':', 2).map(decodeURIComponent); } catch { return apiMessage(c, 401, '客户端认证不合法'); }
	}
	const client = await oidcClient(database, clientId);
	if (!client || client.status !== 'enabled' || !safeEqual(client.secret_hash, await sha256(clientSecret))) return apiMessage(c, 401, '客户端认证失败');
	if (body.grant_type !== 'authorization_code') return apiMessage(c, 400, '仅支持 authorization_code');
	const rawCode = String(body.code ?? ''), code: Code | null = await authorizationCode(database, await sha256(String(body.code ?? '')));
	if (!code || code.client_id !== clientId || code.redirect_uri !== String(body.redirect_uri ?? '') || code.consumed_at || code.expires_at <= Date.now()) return apiMessage(c, 400, '授权码无效、已使用或已过期');
	if (code.code_challenge && (code.code_challenge_method !== 'S256' || !safeEqual(code.code_challenge, await sha256Base64Url(String(body.code_verifier ?? ''))))) return apiMessage(c, 400, 'PKCE 校验失败');
	const user = await accountUser(database, code.user_id);
	if (!user || user.status !== 'enabled') return apiMessage(c, 400, 'Accounts 用户不存在或已停用');
	const accessToken = randomToken(32), now = Date.now(), expiresIn = 3600, issuer = oidcIssuer(c);
	const authorizationCodeHash = await sha256(rawCode);
	const builder = sql(database), consumeCode = builder.update('passport_oidc_authorization_codes', { consumed_at: now }, [{ column: 'code_hash', value: authorizationCodeHash }, { column: 'consumed_at', operator: 'IS NULL' }]);
	const insertToken = builder.insert('passport_oidc_access_tokens', { token_hash: await sha256(accessToken), client_id: clientId, user_id: code.user_id, scope: code.scope, expires_at: now + expiresIn * 1000, created_at: now, session_id: code.session_id, authorization_code_hash: authorizationCodeHash });
	await database.batch([consumeCode, insertToken]);
	const idToken = await signIdToken(database, { iss: issuer, sub: user.sub, aud: clientId, exp: Math.floor(now / 1000) + expiresIn, iat: Math.floor(now / 1000), sid: code.session_id, ...(code.nonce ? { nonce: code.nonce } : {}), name: user.name, ...(user.preferred_username ? { preferred_username: user.preferred_username } : {}), ...(user.email ? { email: user.email, email_verified: true } : {}) });
	return apiResponse(c, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: expiresIn, scope: code.scope, id_token: idToken });
};
export default handler;
