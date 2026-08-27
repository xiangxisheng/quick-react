import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage } from '@server/api-response.mjs';

/** 账户中心的所有接口都要求 Accounts 会话，并且只在 Accounts 站点提供。 */
const handler: ApiHandler = async (c, next) => {
	if (c.get('site').siteKey !== 'passport') return apiMessage(c, 404, '账户中心仅在 Accounts 站点可用');
	if (!c.get('passportDatabase')) return apiMessage(c, 503, 'Accounts 数据库不可用');
	if (!c.get('passportUser')) return apiMessage(c, 401, '请先登录 Accounts');
	return next();
};

export default handler;
