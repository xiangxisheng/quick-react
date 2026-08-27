import type { Context } from 'hono';
import type { AppEnv } from './types.mjs';

const firstForwardedValue = (value: string | undefined) => value?.split(',')[0]?.trim() || '';
const isLocalHost = (hostname: string) => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

export const requestOrigin = (c: Context<AppEnv>) => {
	const url = new URL(c.req.url);
	const forwardedProtocol = firstForwardedValue(c.req.header('x-forwarded-proto'));
	let protocol = forwardedProtocol === 'http' || forwardedProtocol === 'https' ? forwardedProtocol : '';
	if (!protocol) {
		try { protocol = firstForwardedValue(JSON.parse(c.req.header('cf-visitor') ?? '{}').scheme); } catch { /* ignore malformed proxy metadata */ }
	}
	const forwardedHost = firstForwardedValue(c.req.header('x-forwarded-host'));
	const host = forwardedHost && !/[\s/@]/.test(forwardedHost) ? forwardedHost : url.host;
	if (protocol !== 'http' && protocol !== 'https') protocol = url.protocol === 'https:' || !isLocalHost(url.hostname) ? 'https' : 'http';
	return `${protocol}://${host}`;
};

export const isSecureRequest = (c: Context<AppEnv>) => requestOrigin(c).startsWith('https://');
