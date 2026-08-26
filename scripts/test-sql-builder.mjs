import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'quick-react-sql-builder-'));
try {
	const result = await build({ stdin: { contents: "export * from './server/database/sql.mts'; export * from './server/database/schema.mts';", resolveDir: resolve(import.meta.dirname, '..'), sourcefile: 'sql-test-entry.mts' }, bundle: true, format: 'esm', platform: 'node', write: false });
	const file = join(directory, 'sql.mjs'); await writeFile(file, result.outputFiles[0].contents);
	const { SqliteSqlBuilder, MysqlSqlBuilder, PostgresqlSqlBuilder, addColumn, renameColumn, compileSqlPlaceholders } = await import(pathToFileURL(file));
	const sqlite = new SqliteSqlBuilder(), mysql = new MysqlSqlBuilder(), postgres = new PostgresqlSqlBuilder();
	assert.deepEqual(sqlite.insert('users', { name: 'Alice', status: 'enabled' }), { query: 'INSERT INTO "users" ("name", "status") VALUES (?, ?)', values: ['Alice', 'enabled'] });
	assert.match(sqlite.upsert('sessions', ['issuer', 'sid'], { issuer: 'i', sid: 's', session_id: 'x' }, ['session_id']).query, /ON CONFLICT \("issuer", "sid"\) DO UPDATE/);
	assert.match(mysql.upsert('sessions', ['issuer', 'sid'], { issuer: 'i', sid: 's', session_id: 'x' }, ['session_id']).query, /ON DUPLICATE KEY UPDATE `session_id` = VALUES\(`session_id`\)/);
	assert.match(mysql.ignoreInsert('users', ['name'], { name: 'Alice' }).query, /^INSERT IGNORE/);
	assert.deepEqual(postgres.insert('users', { name: 'Alice', status: 'enabled' }), { query: 'INSERT INTO "users" ("name", "status") VALUES ($1, $2)', values: ['Alice', 'enabled'] });
	assert.deepEqual(postgres.count('users', [{ column: 'status', value: 'enabled' }]), { query: 'SELECT COUNT(*) AS "count" FROM "users" WHERE "status" = $1', values: ['enabled'] });
	assert.deepEqual(mysql.select({ table: 'users', includeAll: true, limit: 10, offset: 20 }), { query: 'SELECT * FROM `users` LIMIT ? OFFSET ?', values: [10, 20] });
	assert.equal(sqlite.select({ table: 'users', includeAll: true, sqliteRowIdAlias: '__rowid__' }).query, 'SELECT rowid AS "__rowid__", * FROM "users"');
	assert.throws(() => postgres.select({ table: 'users', sqliteRowIdAlias: '__rowid__' }), /only available for SQLite/);
	assert.deepEqual(addColumn({ dialect: 'mysql' }, 'users', 'display_name', 'VARCHAR(255)', true, "O'Reilly"), { query: "ALTER TABLE `users` ADD COLUMN `display_name` VARCHAR(255) NOT NULL DEFAULT 'O''Reilly'", values: [] });
	assert.deepEqual(addColumn({ dialect: 'postgresql' }, 'users', 'score', 'numeric', false, 0), { query: 'ALTER TABLE "users" ADD COLUMN "score" NUMERIC DEFAULT 0', values: [] });
	assert.deepEqual(renameColumn({ dialect: 'sqlite' }, 'users', 'name', 'display_name'), { query: 'ALTER TABLE "users" RENAME COLUMN "name" TO "display_name"', values: [] });
	assert.throws(() => addColumn({ dialect: 'postgresql' }, 'users', 'score', 'UNSAFE TYPE', false), /支持的字段类型/);
	assert.match(postgres.upsert('sessions', ['issuer', 'sid'], { issuer: 'i', sid: 's', session_id: 'x' }, ['session_id']).query, /ON CONFLICT \("issuer", "sid"\) DO UPDATE/);
	assert.equal(sqlite.castText('user_id'), 'CAST("user_id" AS TEXT)'); assert.equal(mysql.castText('user_id'), 'CAST(`user_id` AS CHAR)');
	assert.throws(() => sqlite.insert('users; DROP TABLE users', { name: 'x' }), /Unsafe SQL identifier/);
	const mysqlLegacy = compileSqlPlaceholders('SELECT ?2 AS second, ?1 AS first, ?2 AS repeated', 'mysql');
	assert.equal(mysqlLegacy.query, 'SELECT ? AS second, ? AS first, ? AS repeated');
	assert.deepEqual(mysqlLegacy.values(['one', 'two']), ['two', 'one', 'two']);
	const postgresLegacy = compileSqlPlaceholders('SELECT ?2 AS second, ?1 AS first, ?2 AS repeated', 'postgresql');
	assert.equal(postgresLegacy.query, 'SELECT $2 AS second, $1 AS first, $2 AS repeated');
	assert.deepEqual(postgresLegacy.values(['one', 'two']), ['one', 'two']);
	console.log('sql builder test passed');
} finally { await rm(directory, { recursive: true, force: true }); }
