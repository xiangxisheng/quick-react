import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiResponse } from '@server/modules/base/api-response.mjs';
import { loadAccountsOidcConfig } from '@server/modules/passport/accounts/client.mjs';
import type { AccountCenterLink } from '@shared/types/user.mjs';

/**
 * 站点启用 Accounts 登录后，账号资料由 Accounts 维护，本站个人中心只做只读展示。
 * 账号中心入口始终在新页面打开：业务站点不会把当前页面带去其它域名。
 */
const handler: ApiHandler = async (c, next) => {
	if (c.req.method !== 'GET') return next();
	const config = await loadAccountsOidcConfig(c);
	let issuer: URL | undefined;
	if (config.enabled && config.issuer) {
		try { issuer = new URL(config.issuer); }
		catch { issuer = undefined; }
	}
	const accounts: { accountsNotice: string; accountsCenter: AccountCenterLink } | undefined = issuer
		? {
			accountsNotice: `用户名、昵称、密码和邮箱由 Accounts 账号中心（${issuer.host}）统一维护，本站只展示当前登录身份。点击下面的按钮会在新页面打开账号中心，当前页面不会离开。`,
			accountsCenter: { label: '在新页面打开账号中心', url: `${issuer.origin}/panel/accounts` },
		}
		: undefined;
	return apiResponse(c, 200, { user: c.get('currentUser'), ...(accounts ?? {}) });
};

export default handler;
