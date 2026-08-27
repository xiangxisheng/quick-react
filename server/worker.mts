import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { compress } from 'hono/compress';
import { etag } from 'hono/etag';
import { renderIndexHtml } from './templates/index.mjs';
import { createApiGateway } from './api-router.mjs';
import { getPageMetadata, getSiteNavigation } from './navigation.mjs';
import { buildAuthState, resolvePagePaths, resolvePageStatus } from './page-context.mjs';
import { createDatabaseConfigStore } from './config-store.mjs';
import { createD1Adapter, type D1DatabaseLike } from './database/d1.mjs';
import { apiMessage } from './api-response.mjs';
import { oidcDiscovery } from './accounts/provider.mjs';
import type { DatabaseAdapter } from './database/index.mjs';
import { SiteRouter } from './site-router.mjs';
import { loadCurrentUser } from './auth.mjs';
import { loadPassportSession } from './passport/session.mjs';
import { loadSystemConfigFromStore } from './system-config.mjs';
import { applyTechStackHeaders, loadTechStackConfigFromStore } from './tech-stack.mjs';
import type { AppEnv, RuntimeBindings } from './types.mjs';
import { workerApiModuleSites, workerApiModules, workerApiRoutes } from './.generated/worker-api-registry.mjs';

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

const resolveSiteDatabase = async (c: Context<WorkerEnv>, site: Parameters<NonNullable<RuntimeBindings['DATABASE_RESOLVER']>>[0], defaultDatabase: DatabaseAdapter) => {
	if (c.env.DATABASE_RESOLVER) return c.env.DATABASE_RESOLVER(site);
	if (site.databaseTarget.kind === 'binding') return asAdapter(c.env[site.databaseTarget.value]);
	if (site.databaseTarget.kind === 'default') return defaultDatabase;
	return undefined;
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

	const database = await resolveSiteDatabase(c, site, defaultDatabase);
	if (!database) throw new Error(`Database target is unavailable for site ${site.siteKey}`);
	const passportSite = site.siteKey === 'passport' ? site : site.siteKey === 'global' ? await siteRouter.resolveBySiteKey('passport', site.hostname) : undefined;
	let passportDatabase: DatabaseAdapter | undefined;
	if (passportSite) {
		try { passportDatabase = passportSite.siteKey === site.siteKey ? database : await resolveSiteDatabase(c, passportSite, defaultDatabase); }
		catch { /* Global administration remains available if Passport storage is temporarily unavailable. */ }
	}

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
	if (passportDatabase) c.set('passportDatabase', passportDatabase);
	c.set('database', database);
	c.set('siteRouter', siteRouter);
	c.set('configStore', configStore);
	c.set('systemConfig', configuration.systemConfig);
	c.set('techStackConfig', configuration.techStackConfig);
	const currentUser = await loadCurrentUser(database, c.req.raw);
	if (currentUser) c.set('currentUser', currentUser);
	// Accounts 会话与站点本地会话相互独立，存在时额外授予 accounts 角色。
	const passportUser = passportDatabase && site.codeSiteChain.includes('accounts_identity')
		? await loadPassportSession(passportDatabase, c.req.raw)
		: undefined;
	if (passportUser) c.set('passportUser', passportUser);
	c.set('effectiveRoles', [
		'public',
		...(currentUser ? ['user', ...currentUser.roles] : []),
		...(passportUser ? ['accounts', ...passportUser.roles] : []),
	]);
	return true;
};

const renderDocument = async (c: Context<WorkerEnv>) => {
	const site = c.get('site');
	const siteConfig = c.get('techStackConfig');
	const systemConfig = c.get('systemConfig');
	const menuItems = getSiteNavigation(site.codeSiteChain, c.get('effectiveRoles'));
	const auth = buildAuthState(c);
	const requestPath = c.req.path;
	const pagePaths = resolvePagePaths(c, auth);
	// 缺少页面后缀的合法路径统一跳转到带后缀的规范地址，避免被当成不存在的路径。
	if (siteConfig.pageSuffix && requestPath !== '/' && !requestPath.endsWith(siteConfig.pageSuffix) && pagePaths.known.has(requestPath)) {
		const target = new URL(c.req.url);
		target.pathname = `${requestPath}${siteConfig.pageSuffix}`;
		return c.redirect(target.toString(), 302);
	}
	const pageStatus = resolvePageStatus(c, requestPath, auth, pagePaths);
	const metadata = pageStatus
		? { title: pageStatus.title, description: pageStatus.description }
		: getPageMetadata(requestPath, menuItems, siteConfig.pageSuffix);
	const title = metadata.title === 'Quick React' ? site.name : `${metadata.title} | ${site.name}`;
	const publicOrigin = systemConfig.publicOrigin || undefined;
	const canonical = publicOrigin && !pageStatus ? new URL(requestPath, publicOrigin).toString() : undefined;
	c.header('Cache-Control', 'no-cache');
	return c.html(renderIndexHtml({
		...metadata,
		title,
		canonical,
		initialData: {
			apiSuffix: siteConfig.apiSuffix,
			pageSuffix: siteConfig.pageSuffix,
			siteName: site.name,
			siteNavigation: menuItems,
			auth: { ...auth, currentUser: c.get('currentUser') ?? c.get('passportUser') },
			footer: `Ant Design ©${new Date().getFullYear()} Created by Ant UED`,
			pageStatus,
		},
	}), (pageStatus?.status ?? 200) as ContentfulStatusCode);
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
	moduleSites: workerApiModuleSites,
	loadModule: async (file) => workerApiModules[file] ?? {},
});
app.all('/api', apiGateway);
app.all('/api/*', (c, next) => apiGateway(c, next));
app.get('/.well-known/openid-configuration', oidcDiscovery);
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
