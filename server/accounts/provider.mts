import type { Context } from 'hono';
import type { AppEnv } from '@server/types.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';

export const oidcIssuer = (c: Context<AppEnv>) => new URL(c.req.url).origin;

export const oidcDiscovery = (c: Context<AppEnv>) => {
	if (c.get('site').siteKey !== 'passport') return apiMessage(c, 404);
	const issuer = oidcIssuer(c);
	return apiResponse(c, 200, {
		issuer,
		authorization_endpoint: `${issuer}/api/oidc/authorize`,
		token_endpoint: `${issuer}/api/oidc/token`,
		userinfo_endpoint: `${issuer}/api/oidc/userinfo`,
		jwks_uri: `${issuer}/api/oidc/jwks`,
		response_types_supported: ['code'],
		subject_types_supported: ['public'],
		id_token_signing_alg_values_supported: ['RS256'],
		scopes_supported: ['openid', 'profile', 'email'],
		token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
		claims_supported: ['sub', 'name', 'email', 'email_verified'],
		code_challenge_methods_supported: ['S256'],
	});
};
