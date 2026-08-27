import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const dropExtra = args.has('--drop-extra');
const yes = args.has('--yes');
const fileArg = process.argv.find((value) => value.startsWith('--file='))?.slice(7);
const groupsArg = process.argv.find((value) => value.startsWith('--groups='))?.slice(9);
const databaseFile = resolve(fileArg || process.env.DEFAULT_DATABASE_FILE || 'database/default.sqlite');
const groups = (groupsArg || 'global,base,passport').split(',').map((value) => value.trim()).filter(Boolean);
if (dropExtra && !yes) throw new Error('删除多余字段必须同时传入 --yes；请先运行 schema:check 查看差异');

const applyMigrations = async (database) => {
	database.exec('CREATE TABLE IF NOT EXISTS global_schema_migrations (migration_key TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)');
	for (const group of groups) {
		const directory = resolve('migrations', group);
		const files = (await readdir(directory).catch(() => [])).filter((file) => file.endsWith('.sql')).sort();
		for (const file of files) {
			const key = `${group}/${file}`;
			if (database.prepare('SELECT 1 FROM global_schema_migrations WHERE migration_key = ?').get(key)) continue;
			database.exec('BEGIN IMMEDIATE');
			try { database.exec(await readFile(join(directory, file), 'utf8')); database.prepare('INSERT INTO global_schema_migrations (migration_key, applied_at) VALUES (?, ?)').run(key, Date.now()); database.exec('COMMIT'); }
			catch (error) { database.exec('ROLLBACK'); throw new Error(`${key} 执行失败：${error instanceof Error ? error.message : error}`); }
		}
	}
};
const tables = (database) => new Map(database.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => [row.name, row.sql]));
const columns = (database, table) => new Set(database.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map((row) => row.name));
const identifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const rebuildTable = (actual, expected, table, createSql, wanted, present) => {
	const temporaryTable = `__schema_repair_${table}`;
	const temporaryCreate = createSql.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)/i, `CREATE TABLE ${identifier(temporaryTable)}`);
	const retained = [...wanted].filter((column) => present.has(column));
	const indexSql = expected.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(table).map((row) => row.sql);
	actual.exec('PRAGMA foreign_keys = OFF');
	actual.exec('BEGIN IMMEDIATE');
	try {
		actual.exec(`DROP TABLE IF EXISTS ${identifier(temporaryTable)}`);
		actual.exec(temporaryCreate);
		if (retained.length) { const fields = retained.map(identifier).join(', '); actual.exec(`INSERT INTO ${identifier(temporaryTable)} (${fields}) SELECT ${fields} FROM ${identifier(table)}`); }
		actual.exec(`DROP TABLE ${identifier(table)}`);
		actual.exec(`ALTER TABLE ${identifier(temporaryTable)} RENAME TO ${identifier(table)}`);
		for (const statement of indexSql) actual.exec(statement);
		actual.exec('COMMIT');
	} catch (error) { actual.exec('ROLLBACK'); throw error; }
	finally { actual.exec('PRAGMA foreign_keys = ON'); }
};

const temporary = await mkdtemp(join(tmpdir(), 'quick-react-schema-'));
const expected = new DatabaseSync(join(temporary, 'expected.sqlite'));
const actual = new DatabaseSync(databaseFile);
try {
	await applyMigrations(expected);
	if (!checkOnly) await applyMigrations(actual);
	const expectedTables = tables(expected), actualTables = tables(actual), differences = [], rebuilds = [];
	for (const [table, createSql] of expectedTables) {
		if (!actualTables.has(table)) { differences.push(`缺少表：${table}`); if (!checkOnly) actual.exec(createSql); continue; }
		const wanted = columns(expected, table), present = columns(actual, table);
		for (const column of wanted) if (!present.has(column)) differences.push(`缺少字段：${table}.${column}（请通过 migration 补齐）`);
		const extras = [...present].filter((column) => !wanted.has(column));
		for (const column of extras) differences.push(`多余字段：${table}.${column}`);
		if (extras.length && !checkOnly && dropExtra) rebuilds.push(() => rebuildTable(actual, expected, table, createSql, wanted, present));
	}
	for (const rebuild of rebuilds) rebuild();
	for (const table of actualTables.keys()) if (!expectedTables.has(table)) differences.push(`未管理表：${table}（不会自动删除）`);
	console.log(differences.length ? differences.join('\n') : '数据库结构与目标结构一致');
	if (!checkOnly) console.log(dropExtra ? `结构修复及多余字段清理完成：${databaseFile}` : `缺失结构修复完成；多余字段需使用 --drop-extra --yes 清理：${databaseFile}`);
} finally { expected.close(); actual.close(); await rm(temporary, { recursive: true, force: true }); }
