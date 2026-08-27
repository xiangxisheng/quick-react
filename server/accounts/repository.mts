import type { DatabaseAdapter } from '@server/database/index.mjs';
import { allSql, firstSql, sql } from '@server/database/sql.mjs';
import { loadAccountUsername } from '@server/passport/account.mjs';

export type OidcClientRecord = { id: string; name: string; secret_hash: string; redirect_uris: string; backchannel_logout_uri: string; allowed_scopes: string; require_pkce: number; status: string; created_at: number; updated_at: number };
export type AuthorizationRequestRecord = { client_id: string; redirect_uri: string; scope: string; state: string; nonce: string; code_challenge: string; code_challenge_method: string; expires_at: number };
export type AuthorizationCodeRecord = { client_id: string; user_id: string; redirect_uri: string; scope: string; nonce: string; code_challenge: string; code_challenge_method: string; expires_at: number; consumed_at: number | null; session_id: string };

export const activeSigningKey = (database: DatabaseAdapter) => firstSql<{ kid: string; private_jwk: string; public_jwk: string }>(database, sql(database).select({ table: 'passport_oidc_signing_keys', columns: { kid: 'kid', private_jwk: 'private_jwk', public_jwk: 'public_jwk' }, where: [{ column: 'status', value: 'active' }], orderBy: [{ column: 'created_at', direction: 'DESC' }], limit: 1 }));
export const signingPublicKeys = (database: DatabaseAdapter) => Promise.all(['active', 'retired'].map((status) => allSql<{ public_jwk: string }>(database, sql(database).select({ table: 'passport_oidc_signing_keys', columns: { public_jwk: 'public_jwk' }, where: [{ column: 'status', value: status }], orderBy: [{ column: 'created_at', direction: 'DESC' }] })))).then((rows) => rows.flat());
export const oidcClients = (database: DatabaseAdapter) => allSql<OidcClientRecord>(database, sql(database).select({ table: 'passport_oidc_clients', columns: { id: 'id', name: 'name', secret_hash: 'secret_hash', redirect_uris: 'redirect_uris', backchannel_logout_uri: 'backchannel_logout_uri', allowed_scopes: 'allowed_scopes', require_pkce: 'require_pkce', status: 'status', created_at: 'created_at', updated_at: 'updated_at' }, orderBy: [{ column: 'created_at', direction: 'DESC' }] }));
export const oidcClient = (database: DatabaseAdapter, id: string) => firstSql<OidcClientRecord>(database, sql(database).select({ table: 'passport_oidc_clients', columns: { id: 'id', name: 'name', secret_hash: 'secret_hash', redirect_uris: 'redirect_uris', backchannel_logout_uri: 'backchannel_logout_uri', allowed_scopes: 'allowed_scopes', require_pkce: 'require_pkce', status: 'status', created_at: 'created_at', updated_at: 'updated_at' }, where: [{ column: 'id', value: id }] }));
export const authorizationRequest = (database: DatabaseAdapter, id: string) => firstSql<AuthorizationRequestRecord>(database, sql(database).select({ table: 'passport_oidc_authorization_requests', columns: { client_id: 'client_id', redirect_uri: 'redirect_uri', scope: 'scope', state: 'state', nonce: 'nonce', code_challenge: 'code_challenge', code_challenge_method: 'code_challenge_method', expires_at: 'expires_at' }, where: [{ column: 'id', value: id }] }));
export const authorizationCode = (database: DatabaseAdapter, hash: string) => firstSql<AuthorizationCodeRecord>(database, sql(database).select({ table: 'passport_oidc_authorization_codes', columns: { client_id: 'client_id', user_id: { column: 'user_id', cast: 'text' }, redirect_uri: 'redirect_uri', scope: 'scope', nonce: 'nonce', code_challenge: 'code_challenge', code_challenge_method: 'code_challenge_method', expires_at: 'expires_at', consumed_at: 'consumed_at', session_id: 'session_id' }, where: [{ column: 'code_hash', value: hash }] }));

export const accountUser = async (database: DatabaseAdapter, userId: string) => {
	const user = await firstSql<{ sub: string; name: string; status: string }>(database, sql(database).select({ table: 'passport_users', columns: { sub: { column: 'user_id', cast: 'text' }, name: 'nickname', status: 'status' }, where: [{ column: 'user_id', value: userId }] }));
	if (!user) return null;
	// 用户名是可选能力，只有设置过才作为 preferred_username 下发。
	const username = await loadAccountUsername(database, userId);
	const email = await firstSql<{ email: string }>(database, sql(database).select({ table: 'passport_user_emails', alias: 'ue', columns: { email: 'e.email' }, joins: [{ table: 'passport_emails', alias: 'e', left: 'e.id', right: 'ue.email_id' }], where: [{ column: 'ue.user_id', value: userId }, { column: 'ue.is_primary', value: 1 }, { column: 'e.verified', value: 1 }], limit: 1 }));
	return { ...user, ...(username ? { preferred_username: username } : {}), email: email?.email };
};

export const accessTokenUser = async (database: DatabaseAdapter, tokenHash: string, now: number) => {
	const token = await firstSql<{ user_id: string }>(database, sql(database).select({ table: 'passport_oidc_access_tokens', alias: 't', columns: { user_id: { column: 't.user_id', cast: 'text' } }, joins: [{ table: 'passport_users', alias: 'u', left: 'u.user_id', right: 't.user_id' }], where: [{ column: 't.token_hash', value: tokenHash }, { column: 't.expires_at', operator: '>', value: now }, { column: 't.revoked_at', operator: 'IS NULL' }, { column: 'u.status', value: 'enabled' }] }));
	return token ? accountUser(database, token.user_id) : null;
};

export const passportSessionUser = (database: DatabaseAdapter, sessionId: string) => firstSql<{ user_id: string }>(database, sql(database).select({ table: 'passport_sessions', columns: { user_id: { column: 'user_id', cast: 'text' } }, where: [{ column: 'id', value: sessionId }] }));
export const backchannelClients = (database: DatabaseAdapter, sessionId: string) => allSql<{ id: string; backchannel_logout_uri: string }>(database, sql(database).select({ table: 'passport_oidc_access_tokens', alias: 't', distinct: true, columns: { id: 'c.id', backchannel_logout_uri: 'c.backchannel_logout_uri' }, joins: [{ table: 'passport_oidc_clients', alias: 'c', left: 'c.id', right: 't.client_id' }], where: [{ column: 't.session_id', value: sessionId }, { column: 't.revoked_at', operator: 'IS NULL' }, { column: 'c.backchannel_logout_uri', operator: '!=', value: '' }] }));
