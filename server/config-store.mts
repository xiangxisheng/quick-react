export type ConfigStore = {
	get: (key: string) => Promise<unknown>;
	put: (key: string, value: unknown) => Promise<void>;
};

const memory = new Map<string, unknown>();

export const memoryConfigStore: ConfigStore = {
	get: async (key) => memory.get(key),
	put: async (key, value) => { memory.set(key, value); },
};

export const createD1ConfigStore = (database: {
	prepare: (query: string) => {
		bind: (...values: string[]) => { first: <T>() => Promise<T | null>; run: () => Promise<unknown> };
	};
}): ConfigStore => ({
	get: async (key) => {
		const row = await database.prepare('SELECT value FROM app_config WHERE key = ?1').bind(key).first<{ value: string }>();
		if (!row) return undefined;
		try {
			return JSON.parse(row.value);
		} catch {
			return undefined;
		}
	},
	put: async (key, value) => {
		await database
			.prepare('INSERT INTO app_config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
			.bind(key, JSON.stringify(value))
			.run();
	},
});
