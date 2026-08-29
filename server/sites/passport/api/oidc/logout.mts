import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiMessage } from '@server/modules/base/api-response.mjs';
import { clearPassportSessionCookie, readPassportSessionId } from '@server/modules/passport/session.mjs';
import { oidcIssuer, revokeOidcSession } from '@server/modules/passport/accounts/provider.mjs';
import { isSecureRequest } from '@server/modules/base/request-origin.mjs';
import { oidcClient } from '@server/modules/passport/accounts/repository.mjs';
import { registeredClientRedirectUris } from '@server/modules/passport/accounts/redirects.mjs';
import { parseFormBody, safeEqual, sha256 } from '@server/modules/passport/accounts/oidc.mjs';
import { firstSql, sql } from '@server/database/sql.mjs';

const handler: ApiHandler = async (c) => {
	if (!['GET', 'POST'].includes(c.req.method)) return apiMessage(c, 404);
	const database = c.get('passportDatabase'); if (!database) return apiMessage(c, 503);
	if (c.req.method === 'POST') {
		const body = await parseFormBody(c.req.raw), clientId = String(body.client_id ?? ''), clientSecret = String(body.client_secret ?? ''), sid = String(body.sid ?? '');
		const client = await oidcClient(database, clientId);
		if (!client || client.status !== 'enabled' || !safeEqual(client.secret_hash, await sha256(clientSecret))) return apiMessage(c, 401, '客户端认证失败');
		const issued = sid ? await firstSql(database, sql(database).select({ table: 'passport_oidc_access_tokens', columns: { session_id: 'session_id' }, where: [{ column: 'client_id', value: clientId }, { column: 'session_id', value: sid }], limit: 1 })) : undefined;
		if (!issued) return apiMessage(c, 400, 'OIDC 会话不存在或不属于当前客户端');
		await revokeOidcSession(database, sid, oidcIssuer(c), c.env.OIDC_FETCH ?? fetch);
		return apiMessage(c, 200, 'Accounts 总会话已注销');
	}
	const clientId = c.req.query('client_id')?.trim() ?? '', postLogout = c.req.query('post_logout_redirect_uri')?.trim() ?? '';
	if (postLogout) {
		const client = clientId ? await oidcClient(database, clientId) : null;
		let allowed = false;
		try {
			const target = new URL(postLogout);
			allowed = Boolean(client && client.status === 'enabled' && (await registeredClientRedirectUris(c, client)).some((uri) => new URL(uri).origin === target.origin));
		} catch { allowed = false; }
		if (!allowed) return apiMessage(c, 400, '注销后回跳地址未注册');
	}
	const sessionId = readPassportSessionId(c.req.raw), secure = isSecureRequest(c);
	if (sessionId) await revokeOidcSession(database, sessionId, oidcIssuer(c), c.env.OIDC_FETCH ?? fetch);
	c.header('Set-Cookie', clearPassportSessionCookie(secure));
	if (postLogout) return c.redirect(postLogout, 302);
	return apiMessage(c, 200, 'Accounts 已退出，关联业务会话正在注销');
};
export default handler;
