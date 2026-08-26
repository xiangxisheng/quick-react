import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseAdapter } from './index.mjs';
import { firstSql, runSql, sql } from './sql.mjs';

const ensureMigrationTable = async (database: DatabaseAdapter) => {
	const keyType = database.dialect === 'mysql' ? 'VARCHAR(512)' : 'TEXT';
	const numberType = database.dialect === 'sqlite' || !database.dialect ? 'INTEGER' : 'BIGINT';
	await database.exec?.(`CREATE TABLE IF NOT EXISTS global_schema_migrations (migration_key ${keyType} PRIMARY KEY NOT NULL, applied_at ${numberType} NOT NULL)`);
};

export const migrateDatabase = async (database: DatabaseAdapter, migrationsRoot: string, migrationGroups: string[]) => {
	if (!database.exec) throw new Error('Database adapter does not support migrations');
	await ensureMigrationTable(database);
	const dialectRoot = database.dialect && database.dialect !== 'sqlite' ? join(migrationsRoot, database.dialect) : migrationsRoot;
	for (const group of migrationGroups) {
		const directory = join(dialectRoot, group);
		const files = (await readdir(directory).catch((error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT' && database.dialect && database.dialect !== 'sqlite') throw new Error(`Missing ${database.dialect} migrations for group ${group}`);
			if (error.code === 'ENOENT') return [];
			throw error;
		})).filter((file) => file.endsWith('.sql')).sort();
		for (const file of files) {
			const migrationKey = `${group}/${file}`;
			const apply = async (target: DatabaseAdapter) => {
				const applied = await firstSql(target, sql(target).select({ table: 'global_schema_migrations', columns: { migration_key: 'migration_key' }, where: [{ column: 'migration_key', value: migrationKey }] }));
				if (applied) return;
				const migrationSql = await readFile(join(directory, file), 'utf8');
				await target.exec?.(migrationSql);
				await runSql(target, sql(target).insert('global_schema_migrations', { migration_key: migrationKey, applied_at: Date.now() }));
			};
			if (database.transaction) await database.transaction(apply);
			else await apply(database);
		}
	}
};

export const migrateDefaultDatabase = (database: DatabaseAdapter, migrationsRoot: string) =>
	migrateDatabase(database, migrationsRoot, ['global', 'base']);

const siteKeyPattern = /^[a-z][a-z0-9_]*$/;

/** Register code-defined business sites without overwriting administrator settings. */
export const initializeCodeSites = async (
	database: DatabaseAdapter,
	codeSites: readonly string[],
	siteNames: Record<string, string> = {},
) => {
	for (const siteKey of codeSites) {
		if (!siteKeyPattern.test(siteKey) || siteKey === 'base' || siteKey === 'global') continue;
		const name = siteNames[siteKey] || siteKey;
		await runSql(database, sql(database).ignoreInsert('global_sites', ['site_key'], { site_key: siteKey, name, base_site_key: 'base', dsn: '', database_binding: '', status: 'enabled', migration_status: 'ready', is_default: 0, is_system: 0 }));
	}
};
