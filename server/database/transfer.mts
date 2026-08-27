import type { DatabaseAdapter } from './index.mjs';
import { listColumns, listTables, synchronizePostgresqlIdentity } from './schema.mjs';
import { allSql, firstSql, runSql, sql, type SqlQuery } from './sql.mjs';

export const portableTableGroups = {
	global: [
		'global_sites', 'global_site_hosts', 'global_cloud_credentials', 'global_cloud_object_storage_buckets',
		'global_cloud_object_storage_bindings', 'global_cloud_object_storage_binding_purposes', 'global_telegram_bots',
		'global_cloud_email_channels', 'global_cloud_email_templates', 'global_cloud_email_bindings',
		'global_cloud_email_template_publications',
	],
	base: [
		'base_system_users', 'base_system_sessions', 'base_system_configs', 'base_system_bootstrap',
		'base_oidc_login_requests', 'base_oidc_accounts', 'base_oidc_sessions',
	],
	passport: [
		'passport_users', 'passport_usernames', 'passport_user_credentials', 'passport_sessions', 'passport_telegram_accounts',
		'passport_oauth_accounts', 'passport_emails', 'passport_user_emails', 'passport_email_otp',
		'passport_user_roles', 'passport_group_prompts', 'passport_snowflake_state', 'passport_telegram_menus',
		'passport_telegram_updates', 'passport_telegram_identity_choices', 'passport_login_challenges',
		'passport_sso_requests', 'passport_login_tickets', 'passport_site_sessions', 'passport_external_identities',
		'passport_oidc_clients', 'passport_oidc_authorization_requests', 'passport_oidc_authorization_codes',
		'passport_oidc_access_tokens', 'passport_oidc_signing_keys', 'passport_external_providers',
		'passport_external_login_states', 'passport_external_pending_identities', 'passport_external_email_otps',
		'passport_external_pending_qr_states', 'passport_user_email_otps',
	],
} as const;

export type PortableTableGroup = keyof typeof portableTableGroups;
export type TransferProgress = { table: string; rows: number };

const seedRows = new Map<string, { column: string; value: string }>([
	['global_sites', { column: 'site_key', value: 'global' }],
	['base_system_bootstrap', { column: 'key', value: 'initial_admin' }],
]);

const targetMustBeEmpty = async (target: DatabaseAdapter, tables: string[]) => {
	for (const table of tables) {
		const count = Number((await firstSql<{ count: number | string }>(target, sql(target).count(table)))?.count ?? 0);
		if (!count) continue;
		const seed = seedRows.get(table);
		if (!seed || count !== 1) throw new Error(`目标表 ${table} 已有 ${count} 行数据；只能迁移到空目标库`);
		const row = await firstSql<Record<string, unknown>>(target, sql(target).select({ table, columns: { value: seed.column }, limit: 1 }));
		if (String(row?.value ?? '') !== seed.value) throw new Error(`目标表 ${table} 包含非迁移种子数据；迁移已拒绝`);
	}
	for (const table of [...tables].reverse()) {
		const seed = seedRows.get(table);
		if (seed) await runSql(target, sql(target).delete(table, { [seed.column]: seed.value }));
	}
};

const transferBatchSize = 200;

export const transferPortableDatabase = async (
	source: DatabaseAdapter,
	target: DatabaseAdapter,
	groups: PortableTableGroup[],
	onProgress: (progress: TransferProgress) => void = () => undefined,
) => {
	if ((source.dialect ?? 'sqlite') !== 'sqlite') throw new Error('数据迁移源必须是 SQLite');
	if (target.dialect !== 'mysql' && target.dialect !== 'postgresql') throw new Error('数据迁移目标必须是 MySQL 或 PostgreSQL');
	const tables = [...new Set(groups.flatMap((group) => [...portableTableGroups[group]]))];
	const sourceTables = new Set((await listTables(source)).map((table) => table.name));
	const targetTables = new Set((await listTables(target)).map((table) => table.name));
	for (const table of tables) {
		if (!sourceTables.has(table)) throw new Error(`SQLite 源库缺少表 ${table}，请先完成源库 migration`);
		if (!targetTables.has(table)) throw new Error(`目标库缺少表 ${table}，请先完成目标库 migration`);
	}
	const copy = async (transactionTarget: DatabaseAdapter) => {
		await targetMustBeEmpty(transactionTarget, tables);
		const result: TransferProgress[] = [];
		for (const table of tables) {
			const [sourceColumns, targetColumns] = await Promise.all([listColumns(source, table), listColumns(transactionTarget, table)]);
			const targetNames = new Set(targetColumns.map((column) => column.name));
			const columns = sourceColumns.map((column) => column.name).filter((column) => targetNames.has(column));
			if (!columns.length) throw new Error(`表 ${table} 没有可迁移的公共字段`);
			const primaryKey = sourceColumns.filter((column) => column.pk > 0).sort((left, right) => left.pk - right.pk).map((column) => column.name);
			if (!primaryKey.length) throw new Error(`表 ${table} 没有主键，无法执行稳定的分批迁移`);
			const selected = Object.fromEntries(columns.map((column) => [column, column]));
			const sourceCount = Number((await firstSql<{ count: number | bigint }>(source, sql(source).count(table)))?.count ?? 0);
			let transferred = 0;
			while (transferred < sourceCount) {
				const rows = await allSql<Record<string, unknown>>(source, sql(source).select({
					table,
					columns: selected,
					orderBy: primaryKey.map((column) => ({ column, direction: 'ASC' })),
					limit: transferBatchSize,
					offset: transferred,
				}));
				if (!rows.length) throw new Error(`表 ${table} 在迁移过程中发生变化，迁移已中止`);
				const statements: SqlQuery[] = rows.map((row) => sql(transactionTarget).insert(table, Object.fromEntries(columns.map((column) => [column, row[column]]))));
				if (transactionTarget.batch) await transactionTarget.batch(statements);
				else for (const statement of statements) await runSql(transactionTarget, statement);
				transferred += rows.length;
			}
			if (transactionTarget.dialect === 'postgresql' && columns.includes('id')) await allSql(transactionTarget, synchronizePostgresqlIdentity(table, 'id'));
			const copied = Number((await firstSql<{ count: number | string }>(transactionTarget, sql(transactionTarget).count(table)))?.count ?? 0);
			if (copied !== sourceCount) throw new Error(`表 ${table} 行数校验失败：源库 ${sourceCount}，目标库 ${copied}`);
			const progress = { table, rows: copied };
			result.push(progress);
			onProgress(progress);
		}
		return result;
	};
	if (!target.transaction) throw new Error('目标数据库适配器不支持事务，迁移已拒绝');
	return target.transaction(copy);
};
