import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { compress } from 'hono/compress';
import { etag } from 'hono/etag';
import { renderIndexHtml } from './templates/base/index.mjs';
import { createApiGateway } from './api-router.mjs';
import { accountsIdentityApi, getPageMetadata, getSiteNavigation, siteProvidesApi } from './navigation.mjs';
import { buildAuthState, resolvePagePaths, resolvePageStatus } from './page-context.mjs';
import { createDatabaseConfigStore } from './modules/base/config-store.mjs';
import { createD1Adapter, type D1DatabaseLike } from './database/d1.mjs';
import { apiMessage } from './api-response.mjs';
import { oidcDiscovery } from './accounts/provider.mjs';
import type { DatabaseAdapter } from './database/index.mjs';
import { SiteRouter } from './site-router.mjs';
import { loadCurrentUser, sessionUsesAccountsOidc } from './auth.mjs';
import { loadAccountsOidcConfig, resolveAccountsLoginMode } from './accounts/client.mjs';
import { clearPassportSessionCookie, loadPassportSession, readPassportSessionId } from './passport/session.mjs';
import { loadSystemConfigFromStore } from './modules/base/system-config.mjs';
import { applyTechStackHeaders, loadTechStackConfigFromStore } from './modules/base/tech-stack.mjs';
import { isSecureRequest } from './request-origin.mjs';
import { loadSiteSettings } from './modules/base/site-settings.mjs';
import { renderPrivacyHtml } from './templates/base/page/privacy.mjs';
import { renderTermsHtml } from './templates/base/page/terms.mjs';
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
	siteSettings: Awaited<ReturnType<typeof loadSiteSettings>>;
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
	// 自带 Accounts 身份的站点用自己的库；控制面额外连一份用于校验关联数据。业务站点只走 OIDC，不直连身份库。
	const accountsIdentity = siteProvidesApi(site.codeSiteChain, accountsIdentityApi);
	const passportSite = accountsIdentity ? site : site.isSystem ? await siteRouter.resolveByApi(accountsIdentityApi, site.hostname) : undefined;
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
		const [systemConfig, techStackConfig, siteSettings] = await Promise.all([
			loadSystemConfigFromStore(configStore),
			loadTechStackConfigFromStore(configStore),
			loadSiteSettings(configStore),
		]);
		configuration = { loadedAt: Date.now(), systemConfig, techStackConfig, siteSettings };
		configurationCache.set(database as object, configuration);
	}
	c.set('site', site);
	c.set('globalDatabase', defaultDatabase);
	if (passportDatabase) c.set('passportDatabase', passportDatabase);
	c.set('database', database);
	c.set('siteRouter', siteRouter);
	c.set('configStore', configStore);
	c.set('systemConfig', configuration.systemConfig);
	c.set('siteSettings', configuration.siteSettings);
	c.set('techStackConfig', configuration.techStackConfig);
	c.set('accountsIdentity', accountsIdentity);
	const accountsConfig = await loadAccountsOidcConfig(c);
	const accountsLoginMode = resolveAccountsLoginMode(accountsConfig);
	c.set('accountsLoginMode', accountsLoginMode);
	const storedCurrentUser = await loadCurrentUser(database, c.req.raw);
	const oidcSession = storedCurrentUser && await sessionUsesAccountsOidc(database, c.req.raw);
	// 开关切换后不继续接受上一种登录方式遗留的 Cookie。
	const currentUser = storedCurrentUser && (accountsLoginMode === 'oidc' ? oidcSession : accountsLoginMode === 'local' && !oidcSession)
		? storedCurrentUser
		: undefined;
	if (currentUser) c.set('currentUser', currentUser);
	// Accounts 会话与站点本地会话相互独立，存在时额外授予 accounts 角色。
	const passportSessionId = readPassportSessionId(c.req.raw);
	const passportUser = passportDatabase && accountsIdentity
		? await loadPassportSession(passportDatabase, c.req.raw)
		: undefined;
	if (passportSessionId && !passportUser) c.header('Set-Cookie', clearPassportSessionCookie(isSecureRequest(c)), { append: true });
	if (passportUser) c.set('passportUser', passportUser);
	// Accounts 会话只带来身份（accounts 角色），站点权限一律来自本站用户自己的角色。
	c.set('effectiveRoles', [
		'public',
		...(currentUser ? ['user', ...currentUser.roles] : []),
		...(passportUser ? ['accounts'] : []),
	]);
	return true;
};

const renderDocument = async (c: Context<WorkerEnv>) => {
	const site = c.get('site');
	const siteConfig = c.get('techStackConfig');
	const systemConfig = c.get('systemConfig');
	const menuItems = getSiteNavigation(site.codeSiteChain, c.get('effectiveRoles'));
	const auth = await buildAuthState(c);
	const requestPath = c.req.path;
	const pagePaths = resolvePagePaths(c, auth);
	// 缺少页面后缀的合法路径统一跳转到带后缀的规范地址，避免被当成不存在的路径。
	if (siteConfig.pageSuffix && requestPath !== '/' && !requestPath.endsWith(siteConfig.pageSuffix) && pagePaths.known.has(requestPath)) {
		const target = new URL(c.req.url);
		target.pathname = `${requestPath}${siteConfig.pageSuffix}`;
		return c.redirect(target.toString(), 302);
	}
	const pageStatus = await resolvePageStatus(c, requestPath, auth, pagePaths);
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
			debug: systemConfig.debug,
			apiSuffix: siteConfig.apiSuffix,
			pageSuffix: siteConfig.pageSuffix,
			siteName: site.name,
			siteNavigation: menuItems,
			auth,
			footer: c.get('siteSettings').footer,
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

/**
 * 源码映射只允许配置的 IP 访问。Node 侧在 app.mts 里按连接地址拦截，
 * Worker 侧没有连接信息，用 Cloudflare 提供的客户端 IP 做同样的限制。
 */
app.use('*', async (c, next) => {
	if (!c.req.path.endsWith('.map') || !c.env.ASSETS) return next();
	const allowed = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1',
		...c.get('systemConfig').mapAllowedIps.split(',').map((ip) => ip.trim()).filter(Boolean)]);
	const clientIp = c.req.header('cf-connecting-ip')?.trim() ?? '';
	if (!allowed.has(clientIp)) return c.text('Not Found', 404);
	return next();
});
app.use('*', async (c, next) => {
	if (!c.env.ASSETS) return next();
	const assetPath = c.req.path.endsWith('.nocache')
		? c.req.path.slice(0, -'.nocache'.length)
		: c.req.path;
	if (assetPath === c.req.path) return next();
	return c.env.ASSETS.fetch(new Request(new URL(assetPath, c.req.url), c.req.raw));
});

const apiGateway = createApiGateway((c) => c.get('techStackConfig').apiSuffix, {
	routes: workerApiRoutes,
	loadModule: async (file) => workerApiModules[file] ?? {},
});
app.all('/api', apiGateway);
app.all('/api/*', (c, next) => apiGateway(c, next));
app.get('/.well-known/openid-configuration', oidcDiscovery);
app.get('/', renderDocument);
app.get('/page/privacy.html', (c) => c.html(renderPrivacyHtml(c.get('site').name, c.get('siteSettings').contactEmail)));
app.get('/page/terms.html', (c) => c.html(renderTermsHtml(c.get('site').name, c.get('siteSettings').contactEmail)));

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
