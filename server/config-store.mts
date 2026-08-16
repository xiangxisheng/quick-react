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
		const row = await database.prepare('SELECT value FROM base_system_configs WHERE key = ?1').bind(key).first<{ value: string }>();
		if (!row) return undefined;
		try {
			return JSON.parse(row.value);
		} catch {
			return undefined;
		}
	},
	put: async (key, value) => {
		await database
			.prepare('INSERT INTO base_system_configs (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
			.bind(key, JSON.stringify(value), Date.now())
			.run();
	},
});

export const createD1ConfigStore = createDatabaseConfigStore;
import type { DatabaseAdapter } from './database/index.mjs';
