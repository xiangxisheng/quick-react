import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage } from '@server/api-response.mjs';

/**
 * Accounts 站点上有两套会话：站点本地账号（user）和 Accounts 账号（accounts）。
 * 需要登录的页面统一在 /panel 下，这里放宽 base 的守卫，让 Accounts 会话也能进入。
 */
const handler: ApiHandler = async (c, next) => {
	const roles = c.get('effectiveRoles');
	if (!roles.includes('user') && !roles.includes('accounts')) return apiMessage(c, 401, '请先登录');
	return next();
};

export default handler;
