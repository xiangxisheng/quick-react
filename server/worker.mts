import { Hono, type Context } from 'hono';
import { compress } from 'hono/compress';
import { etag } from 'hono/etag';
import { renderIndexHtml } from './templates/index.mjs';
import { createApiGateway } from './api-router.mjs';
import { getPageMetadata, getSiteNavigation } from './navigation.mjs';
import { createDatabaseConfigStore } from './config-store.mjs';
import { createD1Adapter, type D1DatabaseLike } from './database/d1.mjs';
import { apiMessage } from './api-response.mjs';
import type { DatabaseAdapter } from './database/index.mjs';
import { SiteRouter } from './site-router.mjs';
import { loadCurrentUser } from './auth.mjs';
import { loadSystemConfigFromStore } from './system-config.mjs';
import { applyTechStackHeaders, loadTechStackConfigFromStore } from './tech-stack.mjs';
import type { AppEnv, RuntimeBindings } from './types.mjs';
import { workerApiModules, workerApiRoutes } from './.generated/worker-api-registry.mjs';

export type WorkerBindings = RuntimeBindings & {
	ASSETS?: { fetch: (request: Request) => Promise<Response> };
};

type WorkerEnv = AppEnv & { Bindings: WorkerBindings };
const app = new Hono<WorkerEnv>();
const adapters = new WeakMap<object, DatabaseAdapter>();
const routers = new WeakMap<object, SiteRouter>();
const configurationCache = new WeakMap<object, {
	loadedAt: number;
	systemConfig: Awaited<ReturnType<typeof loadSystemConfigFromStore>>;
	techStackConfig: Awaited<ReturnType<typeof loadTechStackConfigFromStore>>;
}>();

const asAdapter = (binding: unknown): DatabaseAdapter | undefined => {
	if (!binding || typeof binding !== 'object' || !('prepare' in binding)) return undefined;
	const object = binding as object;
	let adapter = adapters.get(object);
	if (!adapter) {
		adapter = createD1Adapter(binding as D1DatabaseLike);
		adapters.set(object, adapter);
	}
	return adapter;
};

const configureForRequest = async (c: Context<WorkerEnv>) => {
	const defaultBinding = c.env.DEFAULT_DB;
	const defaultDatabase = asAdapter(defaultBinding);
	if (!defaultDatabase || !defaultBinding || typeof defaultBinding !== 'object') return false;
	let siteRouter = routers.get(defaultBinding);
	if (!siteRouter) {
		siteRouter = new SiteRouter(defaultDatabase);
		routers.set(defaultBinding, siteRouter);
	}
	const site = await siteRouter.resolve(c.req.raw);
	if (!site) return false;

	let database: DatabaseAdapter | undefined;
	if (c.env.DATABASE_RESOLVER) database = await c.env.DATABASE_RESOLVER(site);
	else if (site.databaseTarget.kind === 'binding') database = asAdapter(c.env[site.databaseTarget.value]);
	else if (site.databaseTarget.kind === 'default') database = defaultDatabase;
	if (!database) throw new Error(`Database target is unavailable for site ${site.siteKey}`);

	const baseConfigStore = createDatabaseConfigStore(database);
	const configStore = {
		get: baseConfigStore.get,
		put: async (key: string, value: unknown) => {
			await baseConfigStore.put(key, value);
			configurationCache.delete(database as object);
		},
	};
	let configuration = configurationCache.get(database as object);
	if (!configuration || Date.now() - configuration.loadedAt >= 30_000) {
		const [systemConfig, techStackConfig] = await Promise.all([
			loadSystemConfigFromStore(configStore),
			loadTechStackConfigFromStore(configStore),
		]);
		configuration = { loadedAt: Date.now(), systemConfig, techStackConfig };
		configurationCache.set(database as object, configuration);
	}
	c.set('site', site);
	c.set('globalDatabase', defaultDatabase);
	c.set('database', database);
	c.set('siteRouter', siteRouter);
	c.set('configStore', configStore);
	c.set('systemConfig', configuration.systemConfig);
	c.set('techStackConfig', configuration.techStackConfig);
	const currentUser = await loadCurrentUser(database, c.req.raw);
	if (currentUser) c.set('currentUser', currentUser);
	c.set('effectiveRoles', currentUser ? ['public', 'user', ...currentUser.roles] : ['public']);
	return true;
};

const renderDocument = async (c: Context<WorkerEnv>) => {
	const site = c.get('site');
	const siteConfig = c.get('techStackConfig');
	const systemConfig = c.get('systemConfig');
	const menuItems = getSiteNavigation(site.codeSiteChain, c.get('effectiveRoles'));
	const auth = c.get('currentUser')
		? {
			component: 'dropdown' as const,
			actions: [
				{ key: '/panel/me', label: '个人中心', action: 'navigate' as const, icon: 'user' as const },
				{ key: '/sign', label: '退出登录', action: 'logout' as const, icon: 'logout' as const },
			],
			pages: [
				{ path: `/sign${siteConfig.pageSuffix}`, title: '登录', description: '登录 Quick React', mode: 'sign' as const, apiPath: `/api/sign${siteConfig.apiSuffix}`, submitMethod: 'POST' as const, redirectPath: `/panel/admin${siteConfig.pageSuffix}` },
				{ path: `/sign-up${siteConfig.pageSuffix}`, title: '注册', description: '创建初始管理员', mode: 'sign-up' as const, apiPath: `/api/sign${siteConfig.apiSuffix}`, submitMethod: 'PUT' as const, redirectPath: `/sign${siteConfig.pageSuffix}` },
			],
		}
		: {
			component: 'buttons' as const,
			actions: [
				{ key: '/sign', label: '登录', action: 'navigate' as const, icon: 'login' as const },
				{ key: '/sign-up', label: '注册', action: 'navigate' as const, icon: 'register' as const },
			],
			pages: [
				{ path: `/sign${siteConfig.pageSuffix}`, title: '登录', description: '登录 Quick React', mode: 'sign' as const, apiPath: `/api/sign${siteConfig.apiSuffix}`, submitMethod: 'POST' as const, redirectPath: `/panel/admin${siteConfig.pageSuffix}` },
				{ path: `/sign-up${siteConfig.pageSuffix}`, title: '注册', description: '创建初始管理员', mode: 'sign-up' as const, apiPath: `/api/sign${siteConfig.apiSuffix}`, submitMethod: 'PUT' as const, redirectPath: `/sign${siteConfig.pageSuffix}` },
			],
		};
	const metadata = getPageMetadata(c.req.path, menuItems, siteConfig.pageSuffix);
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
			auth: { ...auth, currentUser: c.get('currentUser') },
			footer: `Ant Design ©${new Date().getFullYear()} Created by Ant UED`,
		},
	}));
};

app.use('*', async (c, next) => {
	try {
		if (!await configureForRequest(c)) return c.text('Site Not Found', 404);
		await next();
		applyTechStackHeaders(c.res.headers, c.req.path, c.get('techStackConfig'));
		return undefined;
	} catch (error) {
		console.error(error);
		return apiMessage(c, 503, 'Service configuration unavailable');
	}
});
app.use('*', compress());
app.use('*', etag());

const apiGateway = createApiGateway((c) => c.get('techStackConfig').apiSuffix, {
	routes: workerApiRoutes,
	loadModule: async (file) => workerApiModules[file] ?? {},
});
app.all('/api', apiGateway);
app.all('/api/*', (c, next) => apiGateway(c, next));
app.get('/', renderDocument);

app.get('*', async (c, next) => {
	if (c.req.path.startsWith('/api/') || !c.req.header('accept')?.includes('text/html')) {
		if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
		return next();
	}
	return renderDocument(c);
});

app.notFound(async (c) => {
	if (c.req.path.startsWith('/api/')) return apiMessage(c, 404);
	if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
	return c.text('Not Found', 404);
});

export default app;
