import type { DatabaseAdapter } from './database/index.mjs';
import type { SiteRequestContext, SiteRouter } from './site-router.mjs';
import type { ConfigStore } from './config-store.mjs';
import type { SystemConfig } from './system-config.mjs';
import type { TechStackConfig } from './tech-stack.mjs';

export type RuntimeBindings = Record<string, unknown> & {
	DEFAULT_DB?: unknown;
	DATABASE_RESOLVER?: (site: SiteRequestContext) => Promise<DatabaseAdapter>;
	MIGRATE_SITE?: (siteKey: string) => Promise<void>;
};

export type AppEnv = {
	Bindings: RuntimeBindings;
	Variables: {
		site: SiteRequestContext;
		database: DatabaseAdapter;
		siteRouter: SiteRouter;
		configStore: ConfigStore;
		systemConfig: SystemConfig;
		techStackConfig: TechStackConfig;
		currentUser?: { id: number; username: string; roles: string[] };
		effectiveRoles: string[];
	};
};

export type MockRow = Record<string, unknown> & { key: string };

export type MockColumn = {
	dataIndex: string;
	title: string;
	component?: string;
	dataType?: string;
	dayjsFormat?: string;
};

export type MockTable = {
	columns: MockColumn[];
	rows: MockRow[];
};
