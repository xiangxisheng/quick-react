import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSecureServer } from 'node:http2';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { etag } from 'hono/etag';
import { getClientIp } from './client-ip.mjs';
import worker from './worker.mjs';
import { createSqliteAdapter } from './database/sqlite.mjs';
import { createMysqlAdapter } from './database/mysql.mjs';
import { createPostgresqlAdapter } from './database/postgresql.mjs';
import type { DatabaseAdapter } from './database/index.mjs';
import { initializeCodeSites, migrateDatabase, migrateDefaultDatabase } from './database/migrate.mjs';
import { createDatabaseConfigStore } from './config-store.mjs';
import { configureSystemConfig, loadSystemConfig } from './system-config.mjs';
import { configureTechStack, loadTechStackConfig } from './tech-stack.mjs';
import type { WorkerBindings } from './worker.mjs';
import type { AppEnv } from './types.mjs';
import { workerCodeSites, workerSiteNavigations } from './.generated/worker-api-registry.mjs';

const env = process.env;
const projectDirectory = fileURLToPath(new URL('../', import.meta.url));
const defaultDatabase = createSqliteAdapter(env.DEFAULT_DATABASE_FILE || resolve(projectDirectory, 'database/default.sqlite'));
const siteDatabases = new Map<string, DatabaseAdapter>();
await migrateDefaultDatabase(defaultDatabase, resolve(projectDirectory, 'migrations'));
const resolveSiteDsn = (dsn: string) => {
	let key = dsn, factory: () => DatabaseAdapter;
	if (dsn.startsWith('sqlite://')) {
		const dsnPath = dsn.slice('sqlite://'.length), filename = dsnPath.startsWith('/') ? dsnPath : resolve(projectDirectory, dsnPath);
		key = `sqlite://${filename}`;
		factory = () => createSqliteAdapter(filename);
	} else if (dsn.startsWith('mysql://') || dsn.startsWith('mysql2://')) {
		factory = () => createMysqlAdapter(dsn.replace(/^mysql2:/, 'mysql:'));
	} else if (dsn.startsWith('postgresql://') || dsn.startsWith('postgres://')) {
		factory = () => createPostgresqlAdapter(dsn);
	} else throw new Error('Database DSN must use sqlite://, mysql://, or postgresql://');
	let database = siteDatabases.get(key);
	if (!database) {
		database = factory();
		siteDatabases.set(key, database);
	}
	return database;
};

const migrateSite = async (siteKey: string) => {
	const rows = await defaultDatabase.prepare(`SELECT site_key, base_site_key, dsn, database_binding
		FROM global_sites`).all<{ site_key: string; base_site_key: string | null; dsn: string; database_binding: string }>();
	const sites = new Map(rows.results.map((site) => [site.site_key, site]));
	const site = sites.get(siteKey);
	if (!site || siteKey === 'global') throw new Error('Site is not eligible for business migration');
	if (site.database_binding) throw new Error('D1 Binding migrations must run during deployment');
	const chain: string[] = [];
	const visited = new Set<string>();
	let current = site;
	while (current) {
		if (visited.has(current.site_key) || visited.size >= 8) throw new Error('Invalid site inheritance chain');
		visited.add(current.site_key);
		chain.unshift(current.site_key);
		if (!current.base_site_key || current.base_site_key === 'base') break;
		const parent = sites.get(current.base_site_key);
		if (!parent) throw new Error(`Parent site not found: ${current.base_site_key}`);
		current = parent;
	}
	chain.unshift('base');
	await defaultDatabase.prepare(`UPDATE global_sites SET migration_status = 'migrating' WHERE site_key = ?1`).bind(siteKey).run();
	try {
		const target = site.dsn ? resolveSiteDsn(site.dsn) : defaultDatabase;
		await migrateDatabase(target, resolve(projectDirectory, 'migrations'), chain);
		await defaultDatabase.prepare(`UPDATE global_sites SET migration_status = 'ready' WHERE site_key = ?1`).bind(siteKey).run();
	} catch (error) {
		await defaultDatabase.prepare(`UPDATE global_sites SET migration_status = 'failed' WHERE site_key = ?1`).bind(siteKey).run();
		throw error;
	}
};
await initializeCodeSites(defaultDatabase, workerCodeSites, Object.fromEntries(
	Object.entries(workerSiteNavigations).map(([siteKey, navigation]) => [siteKey, navigation[0]?.label || siteKey]),
));
const codeSiteRows = await defaultDatabase.prepare(`SELECT site_key, database_binding FROM global_sites
	WHERE site_key != 'global' AND site_key != 'base'`).all<{ site_key: string; database_binding: string }>();
for (const site of codeSiteRows.results) {
	if (!workerCodeSites.includes(site.site_key as typeof workerCodeSites[number]) || site.database_binding) continue;
	await migrateSite(site.site_key);
}
const defaultConfigStore = createDatabaseConfigStore(defaultDatabase);
configureSystemConfig({
	store: defaultConfigStore,
	defaults: {
		httpPort: env.HTTP_PORT || '8088',
		domain: env.DOMAIN || 'anan.cc',
		publicOrigin: env.PUBLIC_ORIGIN || '',
		trustedProxyIps: env.TRUSTED_PROXY_IPS || '127.0.0.1,::1,::ffff:127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16',
		mapAllowedIps: env.MAP_ALLOWED_IPS || '127.0.0.1,::1,::ffff:127.0.0.1',
	},
});
configureTechStack({
	store: defaultConfigStore,
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
nodeApp.all('*', (c) => worker.fetch(c.req.raw, {
	DEFAULT_DB: defaultDatabase,
	SNOWFLAKE_WORKER_ID: env.SNOWFLAKE_WORKER_ID || '0',
	DATABASE_RESOLVER: async (site) => {
		if (site.databaseTarget.kind === 'default') return defaultDatabase;
		if (site.databaseTarget.kind !== 'dsn') {
			throw new Error(`Node database target is not supported: ${site.databaseTarget.kind}`);
		}
		return resolveSiteDsn(site.databaseTarget.value);
	},
	MIGRATE_SITE: migrateSite,
	OIDC_FETCH: fetch,
} as WorkerBindings));

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
