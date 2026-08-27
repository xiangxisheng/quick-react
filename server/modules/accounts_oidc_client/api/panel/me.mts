import type { ApiHandler } from '@server/api-router.mjs';
import { apiResponse } from '@server/api-response.mjs';
import { loadAccountsOidcConfig } from '@server/accounts/client.mjs';
import type { AccountCenterLink } from '@shared/types/user.mjs';

/**
 * 站点启用 Accounts 登录后，账号资料由 Accounts 维护，
 * 个人中心只做只读展示并给出前往账户中心的入口。
 */
const handler: ApiHandler = async (c, next) => {
	if (c.req.method !== 'GET') return next();
	const config = await loadAccountsOidcConfig(c);
	// 不带页面后缀，由 Accounts 站点自己跳转到规范地址。
	const accountsCenter: AccountCenterLink | undefined = config.enabled && config.issuer
		? { label: '前往账号中心', url: `${config.issuer.replace(/\/$/, '')}/panel/accounts` }
		: undefined;
	return apiResponse(c, 200, { user: c.get('currentUser'), ...(accountsCenter ? { accountsCenter } : {}) });
};

export default handler;
