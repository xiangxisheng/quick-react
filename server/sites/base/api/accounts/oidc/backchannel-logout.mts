import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiMessage } from '@server/modules/base/api-response.mjs';
import { loadAccountsOidcConfig, loadDiscovery, oidcFetch, verifyIdToken } from '@server/accounts/client.mjs';
import { parseFormBody } from '@server/accounts/oidc.mjs';
import { firstSql, runSql, sql } from '@server/database/sql.mjs';

const handler: ApiHandler = async (c) => {
	if (c.req.method !== 'POST') return apiMessage(c, 405, '只允许 POST 请求');
	const config = await loadAccountsOidcConfig(c); if (!config.enabled) return apiMessage(c, 404);
	try {
		const body = await parseFormBody(c.req.raw), token = String(body.logout_token ?? '');
		const discovery = await loadDiscovery(c, config.issuer), jwksResponse = await oidcFetch(c, discovery.jwks_uri);
		if (!jwksResponse.ok) throw new Error('Accounts 公钥请求失败');
		const claims = await verifyIdToken(token, await jwksResponse.json() as { keys?: JsonWebKey[] }, { issuer: config.issuer, audience: config.clientId, nonce: '' });
		const events = claims.events as Record<string, unknown> | undefined, sid = String(claims.sid ?? '');
		if (!sid || !events?.['http://schemas.openid.net/event/backchannel-logout']) throw new Error('Logout Token 声明不合法');
		const database = c.get('database');
		const session = await firstSql<{ session_id: string }>(database, sql(database).select({ table: 'base_oidc_sessions', columns: { session_id: 'session_id' }, where: [{ column: 'issuer', value: config.issuer }, { column: 'sid', value: sid }] }));
		if (session) { await runSql(database, sql(database).delete('base_system_sessions', { id: session.session_id })); await runSql(database, sql(database).delete('base_oidc_sessions', { issuer: config.issuer, sid })); }
		return apiMessage(c, 200, '会话已注销');
	} catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : 'Logout Token 不合法'); }
};
export default handler;
