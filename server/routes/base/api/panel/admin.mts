import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiMessage } from '@server/modules/base/api-response.mjs';

const handler: ApiHandler = async (c, next) => {
	if (!c.get('effectiveRoles').includes('admin')) return apiMessage(c, 403, '需要管理员角色');
	return next();
};

export default handler;
