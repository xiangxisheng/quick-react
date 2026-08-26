import type { DatabaseAdapter, DatabaseTarget } from './database/index.mjs';
import { allSql, sql } from './database/sql.mjs';

export type SiteRecord = {
	siteKey: string;
	name: string;
	baseSiteKey: string | null;
	dsn: string;
	databaseBinding: string;
	status: string;
	migrationStatus: string;
	isDefault: boolean;
	isSystem: boolean;
};

export type SiteRequestContext = SiteRecord & {
	hostname: string;
	codeSiteChain: string[];
	databaseTarget: DatabaseTarget;
};

type SiteRow = {
	site_key: string;
	name: string;
	base_site_key: string | null;
	dsn: string;
	database_binding: string;
	status: string;
	migration_status: string;
	is_default: number;
	is_system: number;
};

type HostRow = { hostname: string; site_key: string };

type RouteSnapshot = {
	loadedAt: number;
	sites: Map<string, SiteRecord>;
	exactHosts: Map<string, string>;
	wildcardHosts: Array<{ suffix: string; siteKey: string }>;
	defaultSiteKey?: string;
};

const siteKeyPattern = /^[a-z][a-z0-9_]*$/;

export const normalizeHostname = (value: string) => {
	const candidate = value.trim().toLowerCase().replace(/\.$/, '');
	if (!candidate) return '';
	try {
		const authority = candidate.includes(':') && !candidate.startsWith('[') && candidate.split(':').length > 2
			? `[${candidate}]`
			: candidate;
		const hostname = new URL(`http://${authority}`).hostname.toLowerCase().replace(/\.$/, '');
		return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
	} catch {
		return '';
	}
};

const normalizeStoredHostname = (value: string) => value.startsWith('*.')
	? `*.${normalizeHostname(value.slice(2))}`
	: normalizeHostname(value);

const createSiteRecord = (row: SiteRow): SiteRecord => ({
	siteKey: row.site_key,
	name: row.name,
	baseSiteKey: row.base_site_key,
	dsn: row.dsn,
	databaseBinding: row.database_binding,
	status: row.status,
	migrationStatus: row.migration_status,
	isDefault: row.is_default === 1,
	isSystem: row.is_system === 1,
});

const buildSiteChain = (site: SiteRecord, sites: Map<string, SiteRecord>) => {
	const chain: string[] = [];
	const visited = new Set<string>();
	let current: SiteRecord | undefined = site;
	for (let depth = 0; current && depth < 8; depth += 1) {
		if (visited.has(current.siteKey)) throw new Error(`Site inheritance cycle detected at ${current.siteKey}`);
		visited.add(current.siteKey);
		chain.push(current.siteKey);
		if (!current.baseSiteKey || current.baseSiteKey === 'base') {
			chain.push('base');
			return chain;
		}
		current = sites.get(current.baseSiteKey);
		if (!current) throw new Error(`Parent site not found: ${site.baseSiteKey}`);
		if (current.isSystem) throw new Error(`System site cannot be inherited: ${current.siteKey}`);
	}
	throw new Error(`Site inheritance exceeds maximum depth: ${site.siteKey}`);
};

const buildEffectiveSiteChain = (site: SiteRecord, sites: Map<string, SiteRecord>) => {
	const chain = buildSiteChain(site, sites);
	if (site.siteKey === 'passport') {
		const baseIndex = chain.lastIndexOf('base');
		chain.splice(baseIndex < 0 ? chain.length : baseIndex, 0, 'accounts_oidc', 'accounts_identity');
	} else {
		const baseIndex = chain.lastIndexOf('base');
		chain.splice(baseIndex < 0 ? chain.length : baseIndex, 0, 'accounts_oidc_client');
	}
	return chain;
};

export class SiteRouter {
	private snapshot?: RouteSnapshot;
	private loading?: Promise<RouteSnapshot>;

	constructor(private readonly database: DatabaseAdapter, private readonly ttlMs = 30_000) {}

	private async loadSnapshot() {
		const siteRows = await allSql<SiteRow>(this.database, sql(this.database).select({ table: 'global_sites', columns: { site_key: 'site_key', name: 'name', base_site_key: 'base_site_key', dsn: 'dsn', database_binding: 'database_binding', status: 'status', migration_status: 'migration_status', is_default: 'is_default', is_system: 'is_system' }, where: [{ column: 'status', value: 'enabled' }, { column: 'migration_status', value: 'ready' }] }));
		const sites = new Map(siteRows.filter((row) => siteKeyPattern.test(row.site_key)).map((row) => [row.site_key, createSiteRecord(row)]));
		for (const site of sites.values()) buildSiteChain(site, sites);

		const hostRows = await allSql<HostRow>(this.database, sql(this.database).select({ table: 'global_site_hosts', columns: { hostname: 'hostname', site_key: 'site_key' }, where: [{ column: 'status', value: 'enabled' }] }));
		const exactHosts = new Map<string, string>();
		const wildcardHosts: Array<{ suffix: string; siteKey: string }> = [];
		for (const row of hostRows) {
			if (!sites.has(row.site_key)) continue;
			const hostname = normalizeStoredHostname(row.hostname);
			if (!hostname) continue;
			if (hostname.startsWith('*.')) wildcardHosts.push({ suffix: hostname.slice(1), siteKey: row.site_key });
			else exactHosts.set(hostname, row.site_key);
		}
		wildcardHosts.sort((left, right) => right.suffix.length - left.suffix.length);
		const defaultSiteKey = [...sites.values()].find((site) => site.isDefault)?.siteKey;
		return { loadedAt: Date.now(), sites, exactHosts, wildcardHosts, defaultSiteKey };
	}

	async refresh() {
		this.loading ??= this.loadSnapshot().finally(() => { this.loading = undefined; });
		this.snapshot = await this.loading;
		return this.snapshot;
	}

	private async currentSnapshot() {
		if (!this.snapshot || Date.now() - this.snapshot.loadedAt >= this.ttlMs) return this.refresh();
		return this.snapshot;
	}

	async resolve(request: Request): Promise<SiteRequestContext | undefined> {
		const snapshot = await this.currentSnapshot();
		const hostname = normalizeHostname(new URL(request.url).hostname);
		let siteKey = snapshot.exactHosts.get(hostname);
		if (!siteKey) {
			for (const wildcard of snapshot.wildcardHosts) {
				if (!hostname.endsWith(wildcard.suffix)) continue;
				const prefix = hostname.slice(0, -wildcard.suffix.length);
				if (prefix && !prefix.includes('.')) {
					siteKey = wildcard.siteKey;
					break;
				}
			}
		}
		siteKey ??= snapshot.defaultSiteKey;
		const site = siteKey ? snapshot.sites.get(siteKey) : undefined;
		if (!site) return undefined;
		const databaseTarget: DatabaseTarget = site.databaseBinding
			? { kind: 'binding', value: site.databaseBinding }
			: site.dsn ? { kind: 'dsn', value: site.dsn } : { kind: 'default', value: '' };
		return { ...site, hostname, codeSiteChain: buildEffectiveSiteChain(site, snapshot.sites), databaseTarget };
	}

	async resolveBySiteKey(siteKey: string, hostname = ''): Promise<SiteRequestContext | undefined> {
		const snapshot = await this.currentSnapshot();
		const site = snapshot.sites.get(siteKey);
		if (!site) return undefined;
		const databaseTarget: DatabaseTarget = site.databaseBinding
			? { kind: 'binding', value: site.databaseBinding }
			: site.dsn ? { kind: 'dsn', value: site.dsn } : { kind: 'default', value: '' };
		return { ...site, hostname, codeSiteChain: buildEffectiveSiteChain(site, snapshot.sites), databaseTarget };
	}
}
