import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage } from '@server/api-response.mjs';

const handler: ApiHandler = async (c, next) => {
	if (!c.get('effectiveRoles').includes('user')) return apiMessage(c, 401, '请先登录');
	return next();
};

export default handler;
