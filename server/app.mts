import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSecureServer } from 'node:http2';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { compress } from 'hono/compress';
import { etag } from 'hono/etag';
import { Hono, type Context } from 'hono';
import { renderIndexHtml } from './templates/index.mjs';
import { createApiGateway } from './api-router.mjs';
import { getClientIp } from './client-ip.mjs';
import { getPageDefinitions, getPageMetadata, menuItems } from './navigation.mjs';
import type { AppEnv } from './types.mjs';
import { applyTechStackHeaders, getTechStackConfig, loadTechStackConfig } from './tech-stack.mjs';
import { loadSystemConfig } from './system-config.mjs';

export const app = new Hono<AppEnv>();
const systemConfig = await loadSystemConfig();
const port = Number(systemConfig.httpPort) || 8088;
const domain = systemConfig.domain || 'anan.cc';
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const mapAllowedIps = new Set([
	'127.0.0.1',
	'::1',
	'::ffff:127.0.0.1',
	...systemConfig.mapAllowedIps.split(',').map((ip) => ip.trim()).filter(Boolean),
]);

const defaultTrustedProxyRules = '127.0.0.1,::1,::ffff:127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16';

const trustedProxyRules = (systemConfig.trustedProxyIps || defaultTrustedProxyRules)
	.split(',').map((ip) => ip.trim()).filter(Boolean);

const renderDocument = (c: Context<AppEnv>) => {
	const siteConfig = getTechStackConfig();
	const metadata = getPageMetadata(c.req.path, siteConfig.pageSuffix);
	const publicOrigin = systemConfig.publicOrigin || undefined;
	const canonical = publicOrigin ? new URL(c.req.path, publicOrigin).toString() : undefined;
	c.header('Cache-Control', 'no-cache');
	return c.html(renderIndexHtml({
		...metadata,
		canonical,
		initialData: {
			apiSuffix: siteConfig.apiSuffix,
			pageSuffix: siteConfig.pageSuffix,
			siteNavigation: menuItems,
			pages: getPageDefinitions(),
		},
	}));
};

await loadTechStackConfig();

app.use('*', async (c, next) => {
	// API 路由是独立构建产物，不能依赖与主服务共享内存；每次请求从持久化配置同步一次。
	await loadTechStackConfig();
	await next();
	applyTechStackHeaders(c.res.headers, c.req.path);
});

const apiGateway = createApiGateway(() => getTechStackConfig().apiSuffix);
app.all('/api', apiGateway);
app.all('/api/*', apiGateway);
app.get('/', (c) => renderDocument(c));

app.use('*', compress());
app.use('*', etag());
app.use('/bundle.js', async (c, next) => {
	c.header('Cache-Control', 'no-cache');
	await next();
});
app.use('/bundle.js.map', async (c, next) => {
	const clientIp = getClientIp(c, trustedProxyRules);
	if (!clientIp || !mapAllowedIps.has(clientIp)) return c.text('Not Found', 404);
	return next();
});
app.use('*', serveStatic({ root: publicDir }));

app.get('*', async (c, next) => {
	if (c.req.path.startsWith('/api/') || !c.req.header('accept')?.includes('text/html')) return next();
	c.header('Cache-Control', 'no-cache');
	return renderDocument(c);
});

app.notFound((c) => {
	if (c.req.path.startsWith('/api/')) return c.json({ message: 'Not Found' }, 404);
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
		serve({ fetch: app.fetch, port, hostname: '0.0.0.0', createServer: createSecureServer, serverOptions }, (info) => {
			console.log(`HTTP/2 Listening on ${domain}:${info.port}`);
		});
	} catch {
		serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
			console.log(`HTTP/1 Listening on 127.0.0.1:${info.port}`);
		});
	}
};

if (process.env.SKIP_SERVER_LISTEN !== '1') {
	await listen();
}
