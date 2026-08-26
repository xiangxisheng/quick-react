import type { Context } from 'hono';
import type { AppEnv } from '@server/types.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { signIdToken } from '@server/accounts/oidc.mjs';
import { backchannelClients, passportSessionUser } from '@server/accounts/repository.mjs';
import { runSql, sql } from '@server/database/sql.mjs';

export const oidcIssuer = (c: Context<AppEnv>) => new URL(c.req.url).origin;

export const oidcDiscovery = (c: Context<AppEnv>) => {
	if (c.get('site').siteKey !== 'passport') return apiMessage(c, 404);
	const issuer = oidcIssuer(c);
	return apiResponse(c, 200, {
		issuer,
		authorization_endpoint: `${issuer}/api/oidc/authorize`,
		token_endpoint: `${issuer}/api/oidc/token`,
		userinfo_endpoint: `${issuer}/api/oidc/userinfo`,
		end_session_endpoint: `${issuer}/api/oidc/logout`,
		jwks_uri: `${issuer}/api/oidc/jwks`,
		response_types_supported: ['code'],
		subject_types_supported: ['public'],
		id_token_signing_alg_values_supported: ['RS256'],
		scopes_supported: ['openid', 'profile', 'email'],
		token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
		claims_supported: ['sub', 'name', 'email', 'email_verified'],
		code_challenge_methods_supported: ['S256'],
		backchannel_logout_supported: true,
		backchannel_logout_session_supported: true,
	});
};

export const revokeOidcSession = async (database: DatabaseAdapter, sessionId: string, issuer: string, requester: typeof fetch = fetch) => {
	const session = await passportSessionUser(database, sessionId);
	if (!session) return;
	const clients = await backchannelClients(database, sessionId);
	const now = Date.now();
	await runSql(database, sql(database).update('passport_oidc_access_tokens', { revoked_at: now }, [{ column: 'session_id', value: sessionId }, { column: 'revoked_at', operator: 'IS NULL' }]));
	await runSql(database, sql(database).delete('passport_sessions', { id: sessionId }));
	await Promise.allSettled(clients.map(async (client) => {
		const logoutToken = await signIdToken(database, { iss: issuer, sub: session.user_id, aud: client.id, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 120, jti: crypto.randomUUID(), sid: sessionId, events: { 'http://schemas.openid.net/event/backchannel-logout': {} } });
		const response = await requester(client.backchannel_logout_uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ logout_token: logoutToken }) });
		if (!response.ok) throw new Error(`Back-channel logout failed: ${response.status}`);
	}));
};
