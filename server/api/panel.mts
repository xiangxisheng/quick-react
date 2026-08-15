import type { ApiHandler } from '@server/api-router.mjs';

const handler: ApiHandler = async (_c, next) => {
	// 管理后台鉴权统一放在这一层，当前项目暂未接入登录态校验。
	return next();
};

export default handler;
