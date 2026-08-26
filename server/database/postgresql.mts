import pg from 'pg';
import type { DatabaseAdapter, DatabaseRunResult, DatabaseStatement } from './index.mjs';
import { compileSqlPlaceholders } from './placeholders.mjs';

type PostgresqlExecutor = Pick<pg.Pool | pg.PoolClient, 'query'>;

class PostgresqlStatement implements DatabaseStatement {
	private values: unknown[] = [];
	private readonly statement;

	constructor(private readonly executor: PostgresqlExecutor, query: string) {
		this.statement = compileSqlPlaceholders(query, 'postgresql');
	}

	bind(...values: unknown[]) { this.values = values; return this; }
	private execute() { return this.executor.query(this.statement.query, this.statement.values(this.values)); }
	async first<T>() { const result = await this.execute(); return (result.rows[0] as T | undefined) ?? null; }
	async all<T>() { const result = await this.execute(); return { results: result.rows as T[] }; }
	async run(): Promise<DatabaseRunResult> { const result = await this.execute(); return { success: true, meta: { changes: result.rowCount ?? 0 } }; }
}

export const createPostgresqlAdapter = (dsn: string): DatabaseAdapter => {
	const pool = new pg.Pool({ connectionString: dsn, max: 10, idleTimeoutMillis: 60_000 });
	const transactionAdapter = (client: pg.PoolClient): DatabaseAdapter => ({
		dialect: 'postgresql',
		prepare: (query) => new PostgresqlStatement(client, query),
		batch: async (statements) => {
			const results: DatabaseRunResult[] = [];
			for (const item of statements) {
				const compiled = compileSqlPlaceholders(item.query, 'postgresql');
				const result = await client.query(compiled.query, compiled.values(item.values ?? []));
				results.push({ success: true, meta: { changes: result.rowCount ?? 0 } });
			}
			return results;
		},
		exec: async (query) => { await client.query(query); },
	});
	const adapter: DatabaseAdapter = {
		dialect: 'postgresql',
		prepare: (query) => new PostgresqlStatement(pool, query),
		batch: async (statements) => {
			const client = await pool.connect();
			try {
				await client.query('BEGIN');
				const results: DatabaseRunResult[] = [];
				for (const item of statements) {
					const compiled = compileSqlPlaceholders(item.query, 'postgresql');
					const result = await client.query(compiled.query, compiled.values(item.values ?? []));
					results.push({ success: true, meta: { changes: result.rowCount ?? 0 } });
				}
				await client.query('COMMIT');
				return results;
			} catch (error) {
				await client.query('ROLLBACK');
				throw error;
			} finally { client.release(); }
		},
		exec: async (query) => { await pool.query(query); },
		transaction: async (callback) => {
			const client = await pool.connect();
			try { await client.query('BEGIN'); const result = await callback(transactionAdapter(client)); await client.query('COMMIT'); return result; }
			catch (error) { await client.query('ROLLBACK'); throw error; }
			finally { client.release(); }
		},
		close: () => pool.end(),
	};
	return adapter;
};
