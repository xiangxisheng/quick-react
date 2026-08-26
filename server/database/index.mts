export type DatabaseRunResult = {
	success?: boolean;
	meta?: Record<string, unknown>;
};

export type DatabaseBatchStatement = {
	query: string;
	values?: unknown[];
};

export type DatabaseStatement = {
	bind: (...values: unknown[]) => DatabaseStatement;
	first: <T = Record<string, unknown>>() => Promise<T | null>;
	all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
	run: () => Promise<DatabaseRunResult>;
};

export type DatabaseAdapter = {
	prepare: (query: string) => DatabaseStatement;
	batch?: (statements: DatabaseBatchStatement[]) => Promise<DatabaseRunResult[]>;
	exec?: (query: string) => Promise<void>;
};

export type DatabaseTarget = {
	kind: 'default' | 'binding' | 'dsn';
	value: string;
};
