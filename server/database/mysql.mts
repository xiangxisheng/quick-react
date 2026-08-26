import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from 'mysql2/promise';
import type { DatabaseAdapter, DatabaseRunResult, DatabaseStatement } from './index.mjs';
import { compileSqlPlaceholders } from './placeholders.mjs';

type MysqlExecutor = Pick<Pool | PoolConnection, 'execute'>;

const rowsFrom = (result: unknown) => Array.isArray(result) ? result as Record<string, unknown>[] : [];
const mysqlValues = (values: unknown[]) => values.map((value) => typeof value === 'bigint' ? value.toString() : value) as never;
const runResult = (result: unknown): DatabaseRunResult => {
	const header = result as Partial<ResultSetHeader>;
	return { success: true, meta: { changes: Number(header.affectedRows ?? 0), lastRowId: header.insertId === undefined ? undefined : String(header.insertId) } };
};

class MysqlStatement implements DatabaseStatement {
	private values: unknown[] = [];
	private readonly statement;

	constructor(private readonly executor: MysqlExecutor, query: string) {
		this.statement = compileSqlPlaceholders(query, 'mysql');
	}

	bind(...values: unknown[]) { this.values = values; return this; }
	private execute() { return this.executor.execute(this.statement.query, mysqlValues(this.statement.values(this.values))); }
	async first<T>() { const [result] = await this.execute(); return (rowsFrom(result)[0] as T | undefined) ?? null; }
	async all<T>() { const [result] = await this.execute(); return { results: rowsFrom(result) as T[] }; }
	async run() { const [result] = await this.execute(); return runResult(result); }
}

export const createMysqlAdapter = (dsn: string): DatabaseAdapter => {
	const pool = mysql.createPool({ uri: dsn, waitForConnections: true, connectionLimit: 10, maxIdle: 10, idleTimeout: 60_000, queueLimit: 0, enableKeepAlive: true, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: true });
	const transactionAdapter = (connection: PoolConnection): DatabaseAdapter => ({
		dialect: 'mysql',
		prepare: (query) => new MysqlStatement(connection, query),
		batch: async (statements) => {
			const results: DatabaseRunResult[] = [];
			for (const item of statements) {
				const compiled = compileSqlPlaceholders(item.query, 'mysql');
				const [result] = await connection.execute(compiled.query, mysqlValues(compiled.values(item.values ?? [])));
				results.push(runResult(result));
			}
			return results;
		},
		exec: async (query) => { await connection.query(query); },
	});
	const adapter: DatabaseAdapter = {
		dialect: 'mysql',
		prepare: (query) => new MysqlStatement(pool, query),
		batch: async (statements) => {
			const connection = await pool.getConnection();
			try {
				await connection.beginTransaction();
				const results: DatabaseRunResult[] = [];
				for (const item of statements) {
					const compiled = compileSqlPlaceholders(item.query, 'mysql');
					const [result] = await connection.execute(compiled.query, mysqlValues(compiled.values(item.values ?? [])));
					results.push(runResult(result));
				}
				await connection.commit();
				return results;
			} catch (error) {
				await connection.rollback();
				throw error;
			} finally { connection.release(); }
		},
		exec: async (query) => { await pool.query(query); },
		transaction: async (callback) => {
			const connection = await pool.getConnection();
			try { await connection.beginTransaction(); const result = await callback(transactionAdapter(connection)); await connection.commit(); return result; }
			catch (error) { await connection.rollback(); throw error; }
			finally { connection.release(); }
		},
		close: () => pool.end(),
	};
	return adapter;
};
