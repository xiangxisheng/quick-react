import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { sha256 } from '@server/accounts/oidc.mjs';

const handler: ApiHandler = async (c) => {
	if (c.get('site').siteKey !== 'passport' || c.req.method !== 'GET') return apiMessage(c, 404);
	const database = c.get('passportDatabase'); if (!database) return apiMessage(c, 503);
	const authorization = c.req.header('authorization') ?? '';
	if (!authorization.startsWith('Bearer ')) return apiMessage(c, 401, '缺少 Bearer Token');
	const user = await database.prepare(`SELECT CAST(u.user_id AS TEXT) AS sub, u.nickname AS name,
		(SELECT e.email FROM passport_user_emails ue JOIN passport_emails e ON e.id = ue.email_id WHERE ue.user_id = u.user_id AND ue.is_primary = 1 AND e.verified = 1 LIMIT 1) AS email
		FROM passport_oidc_access_tokens t JOIN passport_users u ON u.user_id = t.user_id
		WHERE t.token_hash = ?1 AND t.expires_at > ?2 AND t.revoked_at IS NULL AND u.status = 'enabled'`).bind(await sha256(authorization.slice(7)), Date.now()).first<{ sub: string; name: string; email?: string }>();
	return user ? apiResponse(c, 200, { ...user, ...(user.email ? { email_verified: true } : {}) }) : apiMessage(c, 401, 'Access Token 无效或已过期');
};
export default handler;
