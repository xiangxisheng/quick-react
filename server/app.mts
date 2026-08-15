import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSecureServer } from 'node:http2';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { etag } from 'hono/etag';
import { getClientIp } from './client-ip.mjs';
import worker from './worker.mjs';
import { createJsonFileStore } from './node-config-store.mjs';
import { configureSystemConfig, loadSystemConfig } from './system-config.mjs';
import { configureTechStack, loadTechStackConfig } from './tech-stack.mjs';
import type { WorkerBindings } from './worker.mjs';
import type { AppEnv } from './types.mjs';

const env = process.env;
const configDirectory = join(homedir(), '.quick-react');
configureSystemConfig({
	store: createJsonFileStore(env.SYSTEM_CONFIG_FILE || join(configDirectory, 'system-config.json')),
	defaults: {
		httpPort: env.HTTP_PORT || '8088',
		domain: env.DOMAIN || 'anan.cc',
		publicOrigin: env.PUBLIC_ORIGIN || '',
		trustedProxyIps: env.TRUSTED_PROXY_IPS || '127.0.0.1,::1,::ffff:127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16',
		mapAllowedIps: env.MAP_ALLOWED_IPS || '127.0.0.1,::1,::ffff:127.0.0.1',
	},
});
configureTechStack({
	store: createJsonFileStore(env.TECH_STACK_CONFIG_FILE || join(configDirectory, 'tech-stack.json')),
	defaults: {
		nginx: env.MASK_NGINX === '1',
		phpVersion: env.MASK_PHP_VERSION || '',
		apiSuffix: env.API_ROUTE_SUFFIX ?? '.php',
		pageSuffix: env.PAGE_ROUTE_SUFFIX ?? '.html',
	},
});

const systemConfig = await loadSystemConfig();
await loadTechStackConfig();
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const mapAllowedIps = new Set([
	'127.0.0.1', '::1', '::ffff:127.0.0.1',
	...systemConfig.mapAllowedIps.split(',').map((ip) => ip.trim()).filter(Boolean),
]);
const trustedProxyRules = systemConfig.trustedProxyIps.split(',').map((ip) => ip.trim()).filter(Boolean);

const nodeApp = new Hono<AppEnv>();
nodeApp.use('/bundle.js', async (c, next) => {
	c.header('Cache-Control', 'no-cache');
	await next();
});
nodeApp.use('/bundle.js.map', async (c, next) => {
	const clientIp = getClientIp(c, trustedProxyRules);
	if (!clientIp || !mapAllowedIps.has(clientIp)) return c.text('Not Found', 404);
	return next();
});
nodeApp.use('*', compress());
nodeApp.use('*', etag());
nodeApp.use('*', serveStatic({ root: publicDir }));
nodeApp.all('*', (c) => worker.fetch(c.req.raw, {} as WorkerBindings));

export const app = nodeApp;

const domain = systemConfig.domain || 'anan.cc';
const port = Number(systemConfig.httpPort) || 8088;
const listen = async () => {
	try {
		const baseDir = join(homedir(), '.acme.sh', `${domain}_ecc`);
		const serverOptions = {
			key: await readFile(join(baseDir, `${domain}.key`)),
			cert: await readFile(join(baseDir, 'fullchain.cer')),
		};
		serve({ fetch: app.fetch, port, hostname: '0.0.0.0', createServer: createSecureServer, serverOptions }, (info) => {
			console.log(`HTTP/2 Listening on ${domain}:${info.port}`);
		});
	} catch {
		serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
			console.log(`HTTP/1 Listening on 127.0.0.1:${info.port}`);
		});
	}
};

if (process.env.SKIP_SERVER_LISTEN !== '1') await listen();
