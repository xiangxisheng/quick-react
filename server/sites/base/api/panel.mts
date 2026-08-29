import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage } from '@server/api-response.mjs';

const handler: ApiHandler = async (c, next) => {
	const roles = c.get('effectiveRoles');
	if (!roles.includes('user') && !roles.includes('accounts')) return apiMessage(c, 401, '请先登录');
	return next();
};

export default handler;
