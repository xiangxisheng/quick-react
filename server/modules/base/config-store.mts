export type ConfigStore = {
	get: (key: string) => Promise<unknown>;
	put: (key: string, value: unknown) => Promise<void>;
};

const memory = new Map<string, unknown>();

export const memoryConfigStore: ConfigStore = {
	get: async (key) => memory.get(key),
	put: async (key, value) => { memory.set(key, value); },
};

export const createDatabaseConfigStore = (database: DatabaseAdapter): ConfigStore => ({
	get: async (key) => {
		const row = await firstSql<{ value: string }>(database, sql(database).select({ table: 'base_system_configs', columns: { value: 'value' }, where: [{ column: 'key', value: key }] }));
		if (!row) return undefined;
		try {
			return JSON.parse(row.value);
		} catch {
			return undefined;
		}
	},
	put: async (key, value) => {
		await runSql(database, sql(database).upsert('base_system_configs', ['key'], { key, value: JSON.stringify(value), updated_at: Date.now() }, ['value', 'updated_at']));
	},
});

export const createD1ConfigStore = createDatabaseConfigStore;
import type { DatabaseAdapter } from '../../database/index.mjs';
import { firstSql, runSql, sql } from '../../database/sql.mjs';
