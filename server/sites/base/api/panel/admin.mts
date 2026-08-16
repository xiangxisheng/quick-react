import type { ApiHandler } from '@server/api-router.mjs';

const handler: ApiHandler = async (c, next) => {
	if (!c.get('effectiveRoles').includes('admin')) return c.json({ message: '需要管理员角色' }, 403);
	return next();
};

export default handler;
