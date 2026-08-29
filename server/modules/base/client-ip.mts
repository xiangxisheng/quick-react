import type { Context } from 'hono';
import type { AppEnv } from './types.mjs';

const ipv4ToNumber = (ip: string) => {
	const parts = ip.split('.');
	if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) return undefined;
	return parts.reduce((value, part) => (value * 256) + Number(part), 0) >>> 0;
};

const isIpInRule = (ip: string, rule: string) => {
	if (!rule.includes('/')) return ip === rule;
	const [network, prefixText] = rule.split('/');
	const address = ipv4ToNumber(ip);
	const networkAddress = ipv4ToNumber(network);
	const prefix = Number(prefixText);
	if (address === undefined || networkAddress === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	return (address & mask) === (networkAddress & mask);
};

export const getClientIp = (c: Context<AppEnv>, trustedProxyRules: string[]) => {
	const incoming = c.env.incoming as { socket?: { remoteAddress?: string } } | undefined;
	const remoteAddress = incoming?.socket?.remoteAddress;
	if (!remoteAddress) return undefined;
	if (!trustedProxyRules.some((rule) => isIpInRule(remoteAddress, rule))) return remoteAddress;
	return c.req.header('cf-connecting-ip')?.trim()
		|| c.req.header('x-real-ip')?.trim()
		|| c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
};
