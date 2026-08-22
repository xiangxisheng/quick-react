import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseAdapter } from './index.mjs';

const ensureMigrationTable = async (database: DatabaseAdapter) => {
	await database.exec?.(`CREATE TABLE IF NOT EXISTS global_schema_migrations (
		migration_key TEXT PRIMARY KEY NOT NULL,
		applied_at INTEGER NOT NULL
	)`);
};

export const migrateDatabase = async (database: DatabaseAdapter, migrationsRoot: string, migrationGroups: string[]) => {
	if (!database.exec) throw new Error('Database adapter does not support migrations');
	await ensureMigrationTable(database);
	for (const group of migrationGroups) {
		const directory = join(migrationsRoot, group);
		const files = (await readdir(directory).catch((error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') return [];
			throw error;
		})).filter((file) => file.endsWith('.sql')).sort();
		for (const file of files) {
			const migrationKey = `${group}/${file}`;
			await database.exec('BEGIN IMMEDIATE');
			try {
				const applied = await database.prepare('SELECT migration_key FROM global_schema_migrations WHERE migration_key = ?1').bind(migrationKey).first();
				if (applied) {
					await database.exec('COMMIT');
					continue;
				}
				const sql = await readFile(join(directory, file), 'utf8');
				await database.exec(sql);
				await database.prepare('INSERT INTO global_schema_migrations (migration_key, applied_at) VALUES (?1, ?2)').bind(migrationKey, Date.now()).run();
				await database.exec('COMMIT');
			} catch (error) {
				await database.exec('ROLLBACK');
				throw error;
			}
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
		await database.prepare(`INSERT INTO global_sites
			(site_key, name, base_site_key, dsn, database_binding, status, migration_status, is_default, is_system)
			VALUES (?1, ?2, 'base', '', '', 'enabled', 'ready', 0, 0)
			ON CONFLICT(site_key) DO NOTHING`).bind(siteKey, name).run();
	}
};
