import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const projectDirectory = resolve(import.meta.dirname, '..');
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-database-transfer-test-'));

try {
	const result = await build({
		stdin: {
			contents: "export * from './server/database/sqlite.mts'; export * from './server/database/sql.mts'; export * from './server/database/transfer.mts';",
			resolveDir: projectDirectory,
			sourcefile: 'database-transfer-test-entry.mts',
		},
		bundle: true,
		format: 'esm',
		platform: 'node',
		write: false,
	});
	const moduleFile = join(temporaryDirectory, 'database-transfer.mjs');
	await writeFile(moduleFile, result.outputFiles[0].contents);
	const { createSqliteAdapter, firstSql, runSql, sql, transferPortableDatabase } = await import(pathToFileURL(moduleFile));

	const applyBaseSchema = async (database) => {
		const directory = resolve(projectDirectory, 'migrations/base');
		for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
			await database.exec(await readFile(resolve(directory, file), 'utf8'));
		}
	};

	const mysqlFacade = (backing, { inTransaction = false, failOn = '' } = {}) => ({
		dialect: 'mysql',
		prepare(query) {
			if (query.startsWith('SELECT TABLE_NAME AS name FROM information_schema.TABLES')) {
				return backing.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
			}
			if (query.startsWith('SELECT COLUMN_NAME AS name')) {
				let values = [];
				return {
					bind(...bound) { values = bound; return this; },
					async all() {
						const table = String(values[0] ?? '');
						assert.match(table, /^[A-Za-z_][A-Za-z0-9_]*$/);
						const result = await backing.prepare(`PRAGMA table_info(\`${table}\`)`).all();
						return { results: result.results.map((column) => ({ name: column.name, type: column.type, is_nullable: Number(column.notnull) ? 'NO' : 'YES', pk: Number(column.pk) })) };
					},
					async first() { return (await this.all()).results[0] ?? null; },
					async run() { throw new Error('column metadata statement is read-only'); },
				};
			}
			return backing.prepare(query);
		},
		async batch(statements) {
			const results = [];
			for (const statement of statements) {
				if (failOn && statement.query.includes(failOn)) throw new Error('injected transfer failure');
				results.push(await backing.prepare(statement.query).bind(...statement.values).run());
			}
			return results;
		},
		exec: (query) => backing.exec(query),
		...(inTransaction ? {} : {
			transaction: (callback) => backing.transaction((transactionBacking) => callback(mysqlFacade(transactionBacking, { inTransaction: true, failOn }))),
		}),
	});

	const source = createSqliteAdapter(join(temporaryDirectory, 'source.sqlite'), { readBigInts: true });
	const target = createSqliteAdapter(join(temporaryDirectory, 'target.sqlite'), { readBigInts: true });
	const rollbackTarget = createSqliteAdapter(join(temporaryDirectory, 'rollback.sqlite'), { readBigInts: true });
	try {
		await Promise.all([applyBaseSchema(source), applyBaseSchema(target), applyBaseSchema(rollbackTarget)]);
		const userId = 9007199254740993n;
		await runSql(source, sql(source).insert('base_system_users', { id: userId, username: 'portable', password: 'hash', roles: '[]', status: 'enabled', created_at: 1n, updated_at: 1n }));
		await runSql(source, sql(source).insert('base_system_sessions', { id: 'session', user_id: userId, expires_at: 2n, created_at: 1n }));
		await runSql(source, sql(source).insert('base_system_configs', { key: 'site_title', value: 'Accounts', updated_at: 1n }));

		const progress = await transferPortableDatabase(source, mysqlFacade(target), ['base']);
		assert.equal(progress.length, 7);
		assert.equal((await firstSql(target, sql(target).select({ table: 'base_system_users', columns: { id: 'id' }, limit: 1 }))).id, userId);
		assert.equal((await firstSql(target, sql(target).count('base_system_sessions'))).count, 1n);
		assert.equal((await firstSql(target, sql(target).select({ table: 'base_system_bootstrap', columns: { value: 'value' }, where: [{ column: 'key', value: 'initial_admin' }] }))).value, 'open');

		await assert.rejects(() => transferPortableDatabase(source, mysqlFacade(rollbackTarget, { failOn: 'base_system_sessions' }), ['base']), /injected transfer failure/);
		assert.equal((await firstSql(rollbackTarget, sql(rollbackTarget).count('base_system_users'))).count, 0n);
		assert.equal((await firstSql(rollbackTarget, sql(rollbackTarget).count('base_system_bootstrap'))).count, 1n);
	} finally {
		source.close();
		target.close();
		rollbackTarget.close();
	}

	console.log('database transfer test passed');
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
