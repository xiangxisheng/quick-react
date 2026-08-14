import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSecureServer } from 'node:http2';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { compress } from 'hono/compress';
import { etag } from 'hono/etag';
import { Hono } from 'hono';

const app = new Hono();
const port = Number(process.env.HTTP_PORT) || 8088;
const domain = process.env.DOMAIN || 'anan.cc';
const distDir = fileURLToPath(new URL('../dist/', import.meta.url));

app.get('/api/health', (c) => c.json({ ok: true }));

app.use('*', compress());
app.use('*', etag());
app.use('/bundle.js', async (c, next) => {
	c.header('Cache-Control', 'no-cache');
	await next();
});
app.use('*', serveStatic({ root: distDir }));

app.get('*', async (c, next) => {
	if (c.req.path.startsWith('/api/') || !c.req.header('accept')?.includes('text/html')) {
		return next();
	}
	return serveStatic({ path: 'index.html', root: distDir })(c, next);
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
