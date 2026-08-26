import type { DatabaseAdapter } from '@server/database/index.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const base64Url = (value: Uint8Array | string) => {
	const bytes = typeof value === 'string' ? encoder.encode(value) : value;
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

export const decodeBase64Url = (value: string) => {
	const normalized = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
	const binary = atob(normalized);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const randomToken = (size = 32) => base64Url(crypto.getRandomValues(new Uint8Array(size)));
export const sha256 = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))]
	.map((byte) => byte.toString(16).padStart(2, '0')).join('');
export const sha256Base64Url = async (value: string) => base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));

export const safeEqual = (left: string, right: string) => {
	const leftBytes = encoder.encode(left), rightBytes = encoder.encode(right);
	let difference = leftBytes.length ^ rightBytes.length;
	for (let index = 0; index < Math.max(leftBytes.length, rightBytes.length); index += 1) {
		difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
	}
	return difference === 0;
};

type SigningKeyRow = { kid: string; private_jwk: string; public_jwk: string };
export const ensureSigningKey = async (database: DatabaseAdapter) => {
	let row = await database.prepare(`SELECT kid, private_jwk, public_jwk FROM passport_oidc_signing_keys
		WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`).first<SigningKeyRow>();
	if (row) return row;
	const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
	const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey) as JsonWebKey & Record<string, unknown>;
	const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey & Record<string, unknown>;
	const kid = crypto.randomUUID();
	publicJwk.kid = kid; publicJwk.use = 'sig'; publicJwk.alg = 'RS256';
	privateJwk.kid = kid; privateJwk.use = 'sig'; privateJwk.alg = 'RS256';
	await database.prepare(`INSERT INTO passport_oidc_signing_keys (kid, private_jwk, public_jwk, status, created_at)
		VALUES (?1, ?2, ?3, 'active', ?4)`).bind(kid, JSON.stringify(privateJwk), JSON.stringify(publicJwk), Date.now()).run();
	row = { kid, private_jwk: JSON.stringify(privateJwk), public_jwk: JSON.stringify(publicJwk) };
	return row;
};

export const signIdToken = async (database: DatabaseAdapter, claims: Record<string, unknown>) => {
	const key = await ensureSigningKey(database);
	const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.kid }));
	const payload = base64Url(JSON.stringify(claims));
	const privateKey = await crypto.subtle.importKey('jwk', JSON.parse(key.private_jwk), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
	const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, encoder.encode(`${header}.${payload}`));
	return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
};

export const parseFormBody = async (request: Request) => {
	const contentType = request.headers.get('content-type') ?? '';
	if (contentType.includes('application/json')) return request.json().catch(() => ({})) as Promise<Record<string, unknown>>;
	const text = await request.text();
	return Object.fromEntries(new URLSearchParams(text));
};

export const parseRedirectUris = (value: unknown) => {
	const source = Array.isArray(value) ? value.map(String) : String(value ?? '').split(/[\r\n,]+/);
	const uris = [...new Set(source.map((item) => item.trim()).filter(Boolean))];
	for (const uri of uris) {
		const url = new URL(uri);
		if (url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)))) throw new Error('回调地址必须使用 HTTPS（本地开发地址除外）且不能包含片段');
	}
	if (!uris.length) throw new Error('至少配置一个回调地址');
	return uris;
};

export const decodeJson = <T,>(value: string, fallback: T): T => {
	try { return JSON.parse(value) as T; } catch { return fallback; }
};

export const utf8 = (value: Uint8Array) => decoder.decode(value);

export const oidcRequestCookieName = 'accounts_oidc_request';
export const readCookie = (request: Request, name: string) => {
	for (const part of (request.headers.get('cookie') ?? '').split(';')) {
		const [candidate, ...value] = part.trim().split('=');
		if (candidate === name) return decodeURIComponent(value.join('='));
	}
};
export const oidcRequestCookie = (id: string, secure: boolean) => `${oidcRequestCookieName}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}`;
export const clearOidcRequestCookie = (secure: boolean) => `${oidcRequestCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
