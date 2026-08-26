import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage } from '@server/api-response.mjs';
import { clearPassportSessionCookie, readPassportSessionId } from '@server/passport/session.mjs';
import { oidcIssuer, revokeOidcSession } from '@server/accounts/provider.mjs';

const handler: ApiHandler = async (c) => {
	if (c.get('site').siteKey !== 'passport' || !['GET', 'POST'].includes(c.req.method)) return apiMessage(c, 404);
	const database = c.get('passportDatabase'); if (!database) return apiMessage(c, 503);
	const sessionId = readPassportSessionId(c.req.raw), secure = new URL(c.req.url).protocol === 'https:';
	if (sessionId) await revokeOidcSession(database, sessionId, oidcIssuer(c), c.env.OIDC_FETCH ?? fetch);
	c.header('Set-Cookie', clearPassportSessionCookie(secure));
	return apiMessage(c, 200, 'Accounts 已退出，关联业务会话正在注销');
};
export default handler;
