import type { Context } from 'hono';
import type { AppEnv } from '@server/types.mjs';
import { accountsOidcConfigKey, normalizeAccountsOidcConfig } from '@server/accounts/client.mjs';

/**
 * 身份中心的账号登录开关，和其它站点用同一个配置项：
 * 开启时 /sign 是 Accounts 账号登录，关闭时回到本站账号密码登录。
 * 身份中心默认开启（没配置过时视为开启），保持已部署站点的登录方式不变。
 */
export const accountsLoginEnabled = async (c: Context<AppEnv>) => {
	const stored = await c.get('configStore').get(accountsOidcConfigKey);
	return stored === undefined || stored === null ? true : normalizeAccountsOidcConfig(stored).enabled;
};
