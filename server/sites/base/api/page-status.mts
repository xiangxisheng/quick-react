import type { ApiHandler } from '@server/api-router.mjs';
import { apiResponse } from '@server/api-response.mjs';
import { buildAuthState, resolvePageStatus, unavailablePageStatus } from '@server/page-context.mjs';

const normalizePath = (value: string) => {
	try { return new URL(value, 'http://localhost').pathname.slice(0, 256); }
	catch { return '/'; }
};

// 前端匹配不到页面路由时调用，由后端判断是路径不存在、未登录还是无权访问。
const handler: ApiHandler = (c) => {
	const path = normalizePath(c.req.query('path') ?? '/');
	const pageStatus = resolvePageStatus(c, path, buildAuthState(c)) ?? unavailablePageStatus(path);
	return apiResponse(c, 200, { pageStatus });
};

export default handler;
