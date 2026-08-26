import type { DatabaseAdapter } from './index.mjs';
import { allSql, quoteIdentifier, type SqlDialect, type SqlQuery } from './sql.mjs';

export type DatabaseColumn = { name: string; type: string; notnull: number; pk: number };
export type DatabaseTable = { name: string };

const dialectOf = (database: DatabaseAdapter): SqlDialect => database.dialect ?? 'sqlite';
const safeName = (name: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);

export const listTables = async (database: DatabaseAdapter) => {
	const dialect = dialectOf(database);
	const query = dialect === 'mysql'
		? 'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = \'BASE TABLE\' ORDER BY TABLE_NAME'
		: dialect === 'postgresql'
			? "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name"
			: "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
	return (await allSql<DatabaseTable>(database, { query, values: [] })).filter((table) => safeName(table.name));
};

export const listColumns = async (database: DatabaseAdapter, tableName: string): Promise<DatabaseColumn[]> => {
	if (!safeName(tableName)) throw new Error('数据表名称无效');
	const dialect = dialectOf(database);
	if (dialect === 'sqlite') {
		return (await allSql<DatabaseColumn>(database, { query: `PRAGMA table_info(${quoteIdentifier(tableName, dialect)})`, values: [] })).filter((column) => safeName(column.name));
	}
	if (dialect === 'mysql') {
		const rows = await allSql<{ name: string; type: string; is_nullable: string; pk: number }>(database, {
			query: 'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS is_nullable, CASE WHEN COLUMN_KEY = \'PRI\' THEN 1 ELSE 0 END AS pk FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
			values: [tableName],
		});
		return rows.filter((row) => safeName(row.name)).map((row) => ({ name: row.name, type: row.type, notnull: row.is_nullable === 'NO' ? 1 : 0, pk: Number(row.pk) }));
	}
	const rows = await allSql<{ name: string; type: string; is_nullable: string; pk: number | boolean }>(database, {
		query: `SELECT c.column_name AS name, c.data_type AS type, c.is_nullable,
			CASE WHEN EXISTS (
				SELECT 1 FROM information_schema.table_constraints tc
				JOIN information_schema.key_column_usage kcu
					ON kcu.constraint_name = tc.constraint_name
					AND kcu.constraint_schema = tc.constraint_schema
				WHERE tc.constraint_type = 'PRIMARY KEY'
					AND tc.table_schema = c.table_schema
					AND tc.table_name = c.table_name
					AND kcu.column_name = c.column_name
			) THEN 1 ELSE 0 END AS pk
		FROM information_schema.columns c
		WHERE c.table_schema = current_schema() AND c.table_name = $1
		ORDER BY c.ordinal_position`,
		values: [tableName],
	});
	return rows.filter((row) => safeName(row.name)).map((row) => ({ name: row.name, type: row.type, notnull: row.is_nullable === 'NO' ? 1 : 0, pk: Number(row.pk) }));
};

const typeOptionsByDialect: Record<SqlDialect, Array<{ value: string; text: string }>> = {
	sqlite: ['TEXT', 'INTEGER', 'REAL', 'NUMERIC', 'BLOB'].map((value) => ({ value, text: value })),
	mysql: ['VARCHAR(255)', 'TEXT', 'BIGINT', 'DOUBLE', 'DECIMAL(38,10)', 'BLOB', 'BOOLEAN'].map((value) => ({ value, text: value })),
	postgresql: ['VARCHAR(255)', 'TEXT', 'BIGINT', 'DOUBLE PRECISION', 'NUMERIC', 'BYTEA', 'BOOLEAN'].map((value) => ({ value, text: value })),
};

export const databaseTypeOptions = (database: DatabaseAdapter) => typeOptionsByDialect[dialectOf(database)];
export const databaseLabel = (database: DatabaseAdapter, binding: boolean) => binding ? 'D1（当前）' : `${dialectOf(database) === 'postgresql' ? 'PostgreSQL' : dialectOf(database) === 'mysql' ? 'MySQL' : 'SQLite'}（当前）`;

const quoteDefault = (value: unknown, dialect: SqlDialect) => {
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error('默认值必须是有限数字');
		return String(value);
	}
	if (typeof value === 'bigint') return String(value);
	if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
	if (value === null) return 'NULL';
	const text = String(value);
	const escaped = (dialect === 'mysql' ? text.replaceAll('\\', '\\\\') : text).replaceAll("'", "''");
	return `'${escaped}'`;
};

const assertColumnType = (database: DatabaseAdapter, type: string) => {
	const normalized = type.trim().toUpperCase();
	if (!databaseTypeOptions(database).some((option) => option.value === normalized)) throw new Error('请选择当前数据库支持的字段类型');
	return normalized;
};

export const addColumn = (database: DatabaseAdapter, table: string, name: string, type: string, notnull: boolean, defaultValue?: unknown): SqlQuery => {
	const dialect = dialectOf(database);
	const clauses = [`ALTER TABLE ${quoteIdentifier(table, dialect)} ADD COLUMN ${quoteIdentifier(name, dialect)} ${assertColumnType(database, type)}`];
	if (notnull) clauses.push('NOT NULL');
	if (defaultValue !== undefined && defaultValue !== '') clauses.push(`DEFAULT ${quoteDefault(defaultValue, dialect)}`);
	return { query: clauses.join(' '), values: [] };
};

export const renameColumn = (database: DatabaseAdapter, table: string, oldName: string, newName: string): SqlQuery => ({
	query: `ALTER TABLE ${quoteIdentifier(table, dialectOf(database))} RENAME COLUMN ${quoteIdentifier(oldName, dialectOf(database))} TO ${quoteIdentifier(newName, dialectOf(database))}`,
	values: [],
});

export const dropColumn = (database: DatabaseAdapter, table: string, name: string): SqlQuery => ({
	query: `ALTER TABLE ${quoteIdentifier(table, dialectOf(database))} DROP COLUMN ${quoteIdentifier(name, dialectOf(database))}`,
	values: [],
});
