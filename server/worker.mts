import { Hono, type Context } from 'hono';
import { compress } from 'hono/compress';
import { etag } from 'hono/etag';
import { renderIndexHtml } from './templates/index.mjs';
import { createApiGateway } from './api-router.mjs';
import { getPageMetadata, menuItems } from './navigation.mjs';
import { createD1ConfigStore, memoryConfigStore } from './config-store.mjs';
import { configureSystemConfig, getSystemConfig, loadSystemConfig } from './system-config.mjs';
import { applyTechStackHeaders, configureTechStack, getTechStackConfig, loadTechStackConfig } from './tech-stack.mjs';
import type { AppEnv } from './types.mjs';
import { workerApiModules, workerApiRoutes } from './.generated/worker-api-registry.mjs';

export type WorkerBindings = {
	ASSETS?: { fetch: (request: Request) => Promise<Response> };
	DB?: { prepare: (query: string) => { bind: (...values: string[]) => { first: <T>() => Promise<T | null>; run: () => Promise<unknown> } } };
};

type WorkerEnv = AppEnv & { Bindings: WorkerBindings };
const app = new Hono<WorkerEnv>();
let configBinding: WorkerBindings['DB'];
let workerConfigStore: ReturnType<typeof createD1ConfigStore> | undefined;

const configureForRequest = async (c: Context<WorkerEnv>) => {
	if (c.env.DB) {
		if (configBinding !== c.env.DB) {
			configBinding = c.env.DB;
			workerConfigStore = createD1ConfigStore(c.env.DB);
			configureTechStack({ store: workerConfigStore });
			configureSystemConfig({ store: workerConfigStore });
		}
	}
	await loadTechStackConfig();
	await loadSystemConfig();
};

const renderDocument = async (c: Context<WorkerEnv>) => {
	const siteConfig = getTechStackConfig();
	const systemConfig = getSystemConfig();
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
			footer: `Ant Design ©${new Date().getFullYear()} Created by Ant UED`,
		},
	}));
};

configureTechStack({ store: memoryConfigStore });
configureSystemConfig({ store: memoryConfigStore });

app.use('*', async (c, next) => {
	await configureForRequest(c);
	await next();
	applyTechStackHeaders(c.res.headers, c.req.path);
});
app.use('*', compress());
app.use('*', etag());

const apiGateway = createApiGateway(() => getTechStackConfig().apiSuffix, {
	routes: workerApiRoutes,
	loadModule: async (file) => workerApiModules[file] ?? {},
});
app.all('/api', apiGateway);
app.all('/api/*', apiGateway);
app.get('/', renderDocument);

app.get('*', async (c, next) => {
	if (c.req.path.startsWith('/api/') || !c.req.header('accept')?.includes('text/html')) {
		if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
		return next();
	}
	return renderDocument(c);
});

app.notFound(async (c) => {
	if (c.req.path.startsWith('/api/')) return c.json({ message: 'Not Found' }, 404);
	if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
	return c.text('Not Found', 404);
});

export default app;
