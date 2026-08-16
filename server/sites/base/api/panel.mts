import type { ApiHandler } from '@server/api-router.mjs';

const handler: ApiHandler = async (c, next) => {
	if (!c.get('effectiveRoles').includes('user')) return c.json({ message: '请先登录' }, 401);
	return next();
};

export default handler;
