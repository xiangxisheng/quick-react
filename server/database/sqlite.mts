import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { DatabaseAdapter, DatabaseStatement } from './index.mjs';

type SqliteValue = null | number | bigint | string | Uint8Array;

const sqliteValues = (values: unknown[]) => values.map((value) => {
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (value === null || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string' || value instanceof Uint8Array) return value;
	throw new TypeError(`Unsupported SQLite parameter type: ${typeof value}`);
}) as SqliteValue[];

class SqliteStatement implements DatabaseStatement {
	private values: unknown[] = [];

	constructor(private readonly statement: StatementSync) {}

	bind(...values: unknown[]) {
		this.values = values;
		return this;
	}

	async first<T>() {
		return (this.statement.get(...sqliteValues(this.values)) as T | undefined) ?? null;
	}

	async all<T>() {
		return { results: this.statement.all(...sqliteValues(this.values)) as T[] };
	}

	async run() {
		const result = this.statement.run(...sqliteValues(this.values));
		return {
			success: true,
			meta: { changes: Number(result.changes), lastRowId: result.lastInsertRowid.toString() },
		};
	}
}

export type SqliteDatabaseAdapter = DatabaseAdapter & { close: () => void };

export const createSqliteAdapter = (filename: string): SqliteDatabaseAdapter => {
	mkdirSync(dirname(filename), { recursive: true });
	const database = new DatabaseSync(filename);
	database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
	return {
		prepare: (query) => new SqliteStatement(database.prepare(query)),
		batch: async (statements) => {
			database.exec('BEGIN IMMEDIATE');
			try {
				const results = statements.map(({ query, values = [] }) => {
					const result = database.prepare(query).run(...sqliteValues(values));
					return { success: true, meta: { changes: Number(result.changes), lastRowId: result.lastInsertRowid.toString() } };
				});
				database.exec('COMMIT');
				return results;
			} catch (error) {
				database.exec('ROLLBACK');
				throw error;
			}
		},
		exec: async (query) => { database.exec(query); },
		close: () => database.close(),
	};
};
