import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSecureServer } from 'node:http2';
import { serve } from '@hono/node-server';
import type { Http2Bindings, HttpBindings } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { compress } from 'hono/compress';
import { etag } from 'hono/etag';
import { Hono, type Context } from 'hono';

type AppEnv = { Bindings: HttpBindings | Http2Bindings };
const app = new Hono<AppEnv>();
const port = Number(process.env.HTTP_PORT) || 8088;
const domain = process.env.DOMAIN || 'anan.cc';
const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const indexTemplatePath = fileURLToPath(new URL('../server/templates/index.html', import.meta.url));
const mapAllowedIps = new Set([
	'127.0.0.1',
	'::1',
	'::ffff:127.0.0.1',
	...(process.env.MAP_ALLOWED_IPS || '').split(',').map((ip) => ip.trim()).filter(Boolean),
]);
const defaultTrustedProxyRules = '127.0.0.1,::1,::ffff:127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16';
const trustedProxyRules = (process.env.TRUSTED_PROXY_IPS || defaultTrustedProxyRules)
	.split(',').map((ip) => ip.trim()).filter(Boolean);

const ipv4ToNumber = (ip: string) => {
	const parts = ip.split('.');
	if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) {
		return undefined;
	}
	return parts.reduce((value, part) => (value * 256) + Number(part), 0) >>> 0;
};

const isIpInRule = (ip: string, rule: string) => {
	if (!rule.includes('/')) {
		return ip === rule;
	}
	const [network, prefixText] = rule.split('/');
	const address = ipv4ToNumber(ip);
	const networkAddress = ipv4ToNumber(network);
	const prefix = Number(prefixText);
	if (address === undefined || networkAddress === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
		return false;
	}
	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	return (address & mask) === (networkAddress & mask);
};

const isTrustedProxy = (ip: string) => trustedProxyRules.some((rule) => isIpInRule(ip, rule));

const getClientIp = (c: Context<AppEnv>) => {
	const remoteAddress = c.env.incoming.socket.remoteAddress;
	if (!remoteAddress) {
		return undefined;
	}
	if (!isTrustedProxy(remoteAddress)) {
		return remoteAddress;
	}
	// Only trust forwarded client IP headers when the immediate peer is a trusted proxy.
	return c.req.header('cf-connecting-ip')?.trim()
		|| c.req.header('x-real-ip')?.trim()
		|| c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
};
const menuItems = [
	{ label: '首页', key: '/', icon: 'mail' },
	{ label: '阿里云', key: '/aliyun', icon: 'appstore' },
	{ label: '管理后台', key: '/panel', icon: 'appstore' },
	{ label: '关于', key: '/about', icon: 'appstore' },
	{ label: '登录', key: '/sign', icon: 'appstore' },
];

const renderIndexHtml = async () => {
	const template = await readFile(indexTemplatePath, 'utf8');
	const menuJson = JSON.stringify(menuItems).replaceAll('<', '\\u003c');
	const bootstrapScript = `<script>window.__INITIAL_MENU__=${menuJson};</script>`;
	return template.replace('<script src="/bundle.js"></script>', `${bootstrapScript}\n  <script src="/bundle.js"></script>`);
};

app.get('/api/health', (c) => c.json({ ok: true }));
app.get('/', async (c) => {
	c.header('Cache-Control', 'no-cache');
	return c.html(await renderIndexHtml());
});

app.use('*', compress());
app.use('*', etag());
app.use('/bundle.js', async (c, next) => {
	c.header('Cache-Control', 'no-cache');
	await next();
});
app.use('/bundle.js.map', async (c, next) => {
	const clientIp = getClientIp(c);
	if (!clientIp || !mapAllowedIps.has(clientIp)) {
		return c.text('Not Found', 404);
	}
	return next();
});
app.use('*', serveStatic({ root: publicDir }));

app.get('*', async (c, next) => {
	if (c.req.path.startsWith('/api/') || !c.req.header('accept')?.includes('text/html')) {
		return next();
	}
	c.header('Cache-Control', 'no-cache');
	return c.html(await renderIndexHtml());
});

app.notFound((c) => {
	if (c.req.path.startsWith('/api/')) {
		return c.json({ message: 'Not Found' }, 404);
	}
	return c.text('Not Found', 404);
});

const getAcmeServerOptions = async () => {
	const baseDir = join(homedir(), '.acme.sh', `${domain}_ecc`);
	return {
		key: await readFile(join(baseDir, `${domain}.key`)),
		cert: await readFile(join(baseDir, 'fullchain.cer')),
	};
};

const listen = async () => {
	try {
		const serverOptions = await getAcmeServerOptions();
		serve({
			fetch: app.fetch,
			port,
			hostname: '0.0.0.0',
			createServer: createSecureServer,
			serverOptions,
		}, (info) => {
			console.log(`HTTP/2 Listening on ${domain}:${info.port}`);
		});
	} catch {
		serve({
			fetch: app.fetch,
			port,
			hostname: '0.0.0.0',
		}, (info) => {
			console.log(`HTTP/1 Listening on 127.0.0.1:${info.port}`);
		});
	}
};

await listen();
