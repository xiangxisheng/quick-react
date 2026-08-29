import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { sha256 } from '@server/accounts/oidc.mjs';
import { accessTokenUser } from '@server/accounts/repository.mjs';

const handler: ApiHandler = async (c) => {
	if (c.get('site').siteKey !== 'passport' || c.req.method !== 'GET') return apiMessage(c, 404);
	const database = c.get('passportDatabase'); if (!database) return apiMessage(c, 503);
	const authorization = c.req.header('authorization') ?? '';
	if (!authorization.startsWith('Bearer ')) return apiMessage(c, 401, '缺少 Bearer Token');
	const user = await accessTokenUser(database, await sha256(authorization.slice(7)), Date.now());
	return user ? apiResponse(c, 200, { ...user, ...(user.email ? { email_verified: true } : {}) }) : apiMessage(c, 401, 'Access Token 无效或已过期');
};
export default handler;
