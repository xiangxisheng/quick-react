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

const targetSchema = (source) => {
	const result = {};
	for (const match of source.matchAll(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\n\);/g)) {
		const columns = [];
		for (const rawLine of match[2].split('\n')) {
			const line = rawLine.trim();
			if (!line) continue;
			const token = line.split(/\s+/)[0].replaceAll('`', '').replaceAll('"', '');
			if (!['PRIMARY', 'UNIQUE', 'CONSTRAINT', 'FOREIGN', 'KEY', 'CHECK'].includes(token)) columns.push(token);
		}
		result[match[1]] = columns;
	}
	return result;
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
		const file = resolve(projectDirectory, 'migrations', dialect, group, `0001_${group}_schema.sql`);
		const migration = await readFile(file, 'utf8');
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
