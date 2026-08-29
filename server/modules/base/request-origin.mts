import type { Context } from 'hono';
import type { AppEnv } from './types.mjs';

const isLocalHost = (hostname: string) => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

export const requestOrigin = (c: Context<AppEnv>) => {
	const url = new URL(c.req.url);
	const host = url.host;
	const protocol = !isLocalHost(url.hostname) ? 'https' : url.protocol === 'https:' ? 'https' : 'http';
	return `${protocol}://${host}`;
};

export const isSecureRequest = (c: Context<AppEnv>) => requestOrigin(c).startsWith('https://');
