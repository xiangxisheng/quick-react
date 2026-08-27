import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const projectDirectory = resolve(import.meta.dirname, '..');
const groups = ['global', 'base', 'passport'];
const dialects = ['mysql', 'postgresql'];
const generatedColumns = {
	global_sites: ['active_default'],
	global_cloud_object_storage_binding_purposes: ['default_site_key', 'default_purpose'],
	global_cloud_email_bindings: ['default_site_key', 'default_purpose'],
};

const sorted = (values) => [...values].sort();

const sqliteSchema = async (group) => {
	const database = new DatabaseSync(':memory:');
	database.exec('PRAGMA foreign_keys = ON');
	const directory = resolve(projectDirectory, 'migrations', group);
	for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
		database.exec(await readFile(resolve(directory, file), 'utf8'));
	}
	const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
	const result = Object.fromEntries(tables.map(({ name }) => [name, database.prepare(`PRAGMA table_info(\"${name}\")`).all().map(({ name: column }) => column)]));
	database.close();
	return result;
};

/** 按括号深度切分列定义，兼容多行和单行两种建表写法。 */
const splitDefinitions = (body) => {
	const parts = [];
	let depth = 0, current = '', quote = '';
	for (const character of body) {
		if (quote) {
			current += character;
			if (character === quote) quote = '';
			continue;
		}
		if (character === "'" || character === '"' || character === '`') { quote = character; current += character; continue; }
		if (character === '(') depth += 1;
		if (character === ')') depth -= 1;
		if (character === ',' && depth === 0) { parts.push(current); current = ''; continue; }
		current += character;
	}
	parts.push(current);
	return parts;
};

const tableBody = (source, openIndex) => {
	let depth = 0, quote = '';
	for (let index = openIndex; index < source.length; index += 1) {
		const character = source[index];
		if (quote) {
			if (character === quote) quote = '';
			continue;
		}
		if (character === "'" || character === '"' || character === '`') { quote = character; continue; }
		if (character === '(') depth += 1;
		else if (character === ')') {
			depth -= 1;
			if (!depth) return source.slice(openIndex + 1, index);
		}
	}
	return '';
};

const definitionKeywords = ['PRIMARY', 'UNIQUE', 'CONSTRAINT', 'FOREIGN', 'KEY', 'CHECK', 'INDEX'];

/** 方言迁移按文件顺序累积：先建表，再应用后续迁移补的列，和真实全新安装一致。 */
const targetSchema = (source) => {
	const result = {};
	for (const match of source.matchAll(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
		const body = tableBody(source, match.index + match[0].length - 1);
		const columns = [];
		for (const definition of splitDefinitions(body)) {
			const trimmed = definition.trim();
			if (!trimmed) continue;
			// 约束一律大写书写，被引号包起来的同名列（例如 MySQL 的 `key`）不算约束。
			const raw = trimmed.split(/\s+/)[0];
			if (!definitionKeywords.includes(raw)) columns.push(raw.replaceAll('`', '').replaceAll('"', ''));
		}
		result[match[1]] = columns;
	}
	for (const match of source.matchAll(/ALTER TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi)) {
		const columns = result[match[1]];
		if (columns && !columns.includes(match[2])) columns.push(match[2]);
	}
	return result;
};

const dialectMigrations = async (dialect, group) => {
	const directory = resolve(projectDirectory, 'migrations', dialect, group);
	const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
	const sources = [];
	for (const file of files) sources.push(await readFile(resolve(directory, file), 'utf8'));
	return sources.join('\n');
};

const manifestSource = await readFile(resolve(projectDirectory, 'server/database/transfer.mts'), 'utf8');

for (const group of groups) {
	const expected = await sqliteSchema(group);
	const manifestMatch = manifestSource.match(new RegExp(`\\n\\t${group}: \\[([\\s\\S]*?)\\n\\t\\],?`));
	assert.ok(manifestMatch, `transfer manifest is missing group ${group}`);
	const manifestTables = [...manifestMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
	assert.deepEqual(sorted(manifestTables), sorted(Object.keys(expected)), `${group} transfer manifest must contain every current SQLite table`);
	assert.equal(new Set(manifestTables).size, manifestTables.length, `${group} transfer manifest contains duplicate tables`);

	for (const dialect of dialects) {
		const migration = await dialectMigrations(dialect, group);
		const actual = targetSchema(migration);
		assert.deepEqual(sorted(Object.keys(actual)), sorted(Object.keys(expected)), `${dialect}/${group} table set differs from SQLite`);
		for (const [table, sqliteColumns] of Object.entries(expected)) {
			const portableColumns = (actual[table] ?? []).filter((column) => !(generatedColumns[table] ?? []).includes(column));
			assert.deepEqual(sorted(portableColumns), sorted(sqliteColumns), `${dialect}/${group}/${table} columns differ from SQLite`);
		}

		const forbidden = dialect === 'mysql'
			? [/\bAUTOINCREMENT\b/i, /\bPRAGMA\b/i, /sqlite_/i, /\bON CONFLICT\b/i, /\bINSERT OR\b/i, /\bGLOB\b/i]
			: [/\bAUTO_INCREMENT\b/i, /\bINSERT IGNORE\b/i, /`/, /^\s*KEY\s/m, /\bTINYINT\b/i, /\bLONGTEXT\b/i, /\bREGEXP\b/i];
		for (const pattern of forbidden) assert.doesNotMatch(migration, pattern, `${dialect}/${group} contains foreign-dialect SQL: ${pattern}`);
		if (dialect === 'mysql') assert.doesNotMatch(migration, /UNIQUE KEY[^\n]*\b[A-Za-z_][A-Za-z0-9_]*\(\d+\)/, `${dialect}/${group} must not use lossy prefix uniqueness`);
	}
}

console.log('database migration schema test passed');
