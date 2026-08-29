import type { Context } from 'hono';
import type { AppEnv } from '@server/modules/base/types.mjs';
import { base64Url, decodeBase64Url, safeEqual, utf8 } from '@server/accounts/oidc.mjs';

export type AccountsOidcClientConfig = { enabled: boolean; issuer: string; clientId: string; clientSecret: string };
export type AccountsLoginMode = 'local' | 'oidc';
export const accountsOidcConfigKey = 'accounts-oidc-client';
export const defaultAccountsOidcConfig: AccountsOidcClientConfig = { enabled: false, issuer: '', clientId: '', clientSecret: '' };

export const normalizeAccountsOidcConfig = (value: unknown, previous = defaultAccountsOidcConfig): AccountsOidcClientConfig => {
	const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	let issuer = typeof source.issuer === 'string' ? source.issuer.trim().replace(/\/$/, '') : previous.issuer;
	try { const url = new URL(issuer); issuer = url.pathname === '/' && !url.search && !url.hash ? url.origin : ''; } catch { issuer = ''; }
	return {
		enabled: source.enabled === true,
		issuer,
		clientId: typeof source.clientId === 'string' ? source.clientId.trim() : previous.clientId,
		clientSecret: typeof source.clientSecret === 'string' && source.clientSecret ? source.clientSecret : previous.clientSecret,
	};
};

/** 所有站点共用同一条登录策略；只有 Accounts 凭据处理器按站点能力分流。 */
export const resolveAccountsLoginMode = (config: AccountsOidcClientConfig): AccountsLoginMode => config.enabled ? 'oidc' : 'local';

export const loadAccountsOidcConfig = async (c: Context<AppEnv>) => normalizeAccountsOidcConfig(await c.get('configStore').get(accountsOidcConfigKey));
export const oidcFetch = (c: Context<AppEnv>, input: RequestInfo | URL, init?: RequestInit) => c.env.OIDC_FETCH ? c.env.OIDC_FETCH(input, init) : fetch(input, init);
export type OidcDiscovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; userinfo_endpoint?: string; end_session_endpoint?: string };
export const loadDiscovery = async (c: Context<AppEnv>, issuer: string) => {
	const response = await oidcFetch(c, `${issuer}/.well-known/openid-configuration`);
	if (!response.ok) throw new Error(`Accounts 发现文档请求失败（HTTP ${response.status}）`);
	const discovery = await response.json() as OidcDiscovery;
	if (discovery.issuer !== issuer) {
		try {
			const configured = new URL(issuer), discovered = new URL(discovery.issuer);
			if (configured.hostname !== discovered.hostname || configured.port !== discovered.port || configured.protocol !== 'https:' || discovered.protocol !== 'http:') throw new Error('issuer mismatch');
			for (const key of ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint', 'jwks_uri', 'end_session_endpoint'] as const) {
				const endpoint = discovery[key];
				if (endpoint) {
					const url = new URL(endpoint);
					if (url.hostname !== discovered.hostname || url.port !== discovered.port) throw new Error('endpoint host mismatch');
					(discovery[key] as string) = `${configured.origin}${url.pathname}${url.search}`;
				}
			}
			discovery.issuer = issuer;
		} catch { throw new Error('Accounts 发现文档不合法或 issuer 不匹配'); }
	}
	if (!discovery.authorization_endpoint || !discovery.token_endpoint || !discovery.jwks_uri) throw new Error('Accounts 发现文档缺少必要端点');
	return discovery;
};

export const verifyIdToken = async (token: string, jwks: { keys?: JsonWebKey[] }, expected: { issuer: string; audience: string; nonce: string }) => {
	const parts = token.split('.'); if (parts.length !== 3) throw new Error('ID Token 格式不合法');
	const header = JSON.parse(utf8(decodeBase64Url(parts[0]))) as { alg?: string; kid?: string };
	const claims = JSON.parse(utf8(decodeBase64Url(parts[1]))) as Record<string, unknown>;
	if (header.alg !== 'RS256' || !header.kid) throw new Error('ID Token 签名算法不受支持');
	const jwk = jwks.keys?.find((key) => (key as JsonWebKey & { kid?: string }).kid === header.kid);
	if (!jwk) throw new Error('找不到 ID Token 对应公钥');
	const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
	const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
	const audiences = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud ?? '')];
	if (!valid || claims.iss !== expected.issuer || !audiences.includes(expected.audience) || !safeEqual(String(claims.nonce ?? ''), expected.nonce)
		|| !Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= Math.floor(Date.now() / 1000) || typeof claims.sub !== 'string' || !claims.sub) throw new Error('ID Token 签名或声明校验失败');
	return claims;
};

export const accountsLoginCookieName = 'accounts_oidc_login';
export const accountsLoginCookie = (id: string, secure: boolean) => `${accountsLoginCookieName}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}`;
export const clearAccountsLoginCookie = (secure: boolean) => `${accountsLoginCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
