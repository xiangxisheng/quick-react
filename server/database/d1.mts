import type { DatabaseAdapter, DatabaseStatement } from './index.mjs';

type D1StatementLike = {
	bind: (...values: unknown[]) => D1StatementLike;
	first: <T>() => Promise<T | null>;
	all: <T>() => Promise<{ results: T[] }>;
	run: () => Promise<{ success?: boolean; meta?: Record<string, unknown> }>;
};

export type D1DatabaseLike = {
	prepare: (query: string) => D1StatementLike;
	exec?: (query: string) => Promise<unknown>;
};

export const createD1Adapter = (database: D1DatabaseLike): DatabaseAdapter => ({
	prepare: (query): DatabaseStatement => database.prepare(query),
	exec: database.exec ? async (query) => { await database.exec?.(query); } : undefined,
});
