import type { DatabaseAdapter, DatabaseStatement } from './index.mjs';

type D1StatementLike = {
	bind: (...values: unknown[]) => D1StatementLike;
	first: <T>() => Promise<T | null>;
	all: <T>() => Promise<{ results: T[] }>;
	run: () => Promise<{ success?: boolean; meta?: Record<string, unknown> }>;
};

type D1RunResult = { success?: boolean; meta?: Record<string, unknown> };

export type D1DatabaseLike = {
	prepare: (query: string) => D1StatementLike;
	batch?: (statements: D1StatementLike[]) => Promise<D1RunResult[]>;
	exec?: (query: string) => Promise<unknown>;
};

export const createD1Adapter = (database: D1DatabaseLike): DatabaseAdapter => ({
	dialect: 'sqlite',
	prepare: (query): DatabaseStatement => database.prepare(query),
	batch: database.batch ? async (statements) => database.batch?.(statements.map(({ query, values = [] }) => database.prepare(query).bind(...values))) ?? [] : undefined,
	exec: database.exec ? async (query) => { await database.exec?.(query); } : undefined,
});
