import type { DatabaseAdapter } from './database/index.mjs';
import type { SiteRequestContext, SiteRouter } from './site-router.mjs';
import type { ConfigStore } from './config-store.mjs';
import type { SystemConfig } from './system-config.mjs';
import type { TechStackConfig } from './tech-stack.mjs';
import type { UserIdentity } from '@shared/types/user.mjs';
import type { TableColumn, TableRow } from '@shared/types/table.mjs';

export type RuntimeBindings = Record<string, unknown> & {
	DEFAULT_DB?: unknown;
	DATABASE_RESOLVER?: (site: SiteRequestContext) => Promise<DatabaseAdapter>;
	MIGRATE_SITE?: (siteKey: string) => Promise<void>;
};

export type AppEnv = {
	Bindings: RuntimeBindings;
	Variables: {
		site: SiteRequestContext;
		globalDatabase: DatabaseAdapter;
		database: DatabaseAdapter;
		siteRouter: SiteRouter;
		configStore: ConfigStore;
		systemConfig: SystemConfig;
		techStackConfig: TechStackConfig;
		currentUser?: UserIdentity;
		effectiveRoles: string[];
	};
};

export type MockRow = TableRow;
export type MockColumn = TableColumn;
export type MockTable = { columns: MockColumn[]; rows: MockRow[] };
