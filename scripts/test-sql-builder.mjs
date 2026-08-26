import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'quick-react-sql-builder-'));
try {
	const result = await build({ entryPoints: [resolve(import.meta.dirname, '../server/database/sql.mts')], bundle: true, format: 'esm', platform: 'node', write: false });
	const file = join(directory, 'sql.mjs'); await writeFile(file, result.outputFiles[0].contents);
	const { SqliteSqlBuilder, MysqlSqlBuilder, PostgresqlSqlBuilder, compileSqlPlaceholders } = await import(pathToFileURL(file));
	const sqlite = new SqliteSqlBuilder(), mysql = new MysqlSqlBuilder(), postgres = new PostgresqlSqlBuilder();
	assert.deepEqual(sqlite.insert('users', { name: 'Alice', status: 'enabled' }), { query: 'INSERT INTO "users" ("name", "status") VALUES (?, ?)', values: ['Alice', 'enabled'] });
	assert.match(sqlite.upsert('sessions', ['issuer', 'sid'], { issuer: 'i', sid: 's', session_id: 'x' }, ['session_id']).query, /ON CONFLICT \("issuer", "sid"\) DO UPDATE/);
	assert.match(mysql.upsert('sessions', ['issuer', 'sid'], { issuer: 'i', sid: 's', session_id: 'x' }, ['session_id']).query, /ON DUPLICATE KEY UPDATE `session_id` = VALUES\(`session_id`\)/);
	assert.match(mysql.ignoreInsert('users', ['name'], { name: 'Alice' }).query, /^INSERT IGNORE/);
	assert.deepEqual(postgres.insert('users', { name: 'Alice', status: 'enabled' }), { query: 'INSERT INTO "users" ("name", "status") VALUES ($1, $2)', values: ['Alice', 'enabled'] });
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
