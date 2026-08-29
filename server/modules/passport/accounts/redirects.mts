import type { Context } from 'hono';
import type { AppEnv } from '@server/modules/base/types.mjs';
import { loadAccountsOidcConfig } from '@server/modules/passport/accounts/client.mjs';
import { allSql, sql } from '@server/database/sql.mjs';

type RedirectClient = { id: string; redirect_uris: string; strict_redirect_uri: number };

/**
 * 严格模式只接受客户端手工登记的地址。
 * 默认模式另外接受共享客户端所在数据库中已启用站点的标准回调。
 */
export const registeredClientRedirectUris = async (c: Context<AppEnv>, client: RedirectClient) => {
	const configured = JSON.parse(client.redirect_uris) as string[];
	if (client.strict_redirect_uri) return configured;
	const config = await loadAccountsOidcConfig(c);
	if (config.clientId !== client.id) return configured;
	const site = c.get('site'), database = c.get('globalDatabase');
	const rows = await allSql<{ hostname: string }>(database, sql(database).select({
		table: 'global_site_hosts', alias: 'h', columns: { hostname: 'h.hostname' },
		joins: [{ table: 'global_sites', alias: 's', left: 's.site_key', right: 'h.site_key' }],
		where: [{ column: 'h.status', value: 'enabled' }, { column: 's.status', value: 'enabled' }, { column: 's.migration_status', value: 'ready' }, { column: 's.dsn', value: site.dsn }, { column: 's.database_binding', value: site.databaseBinding }],
	}));
	const standard = rows.filter((row) => !row.hostname.startsWith('*.')).map((row) => `https://${row.hostname}/api/accounts/oidc/callback`);
	return [...new Set([...configured, ...standard])];
};
