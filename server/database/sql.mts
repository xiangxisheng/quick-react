import type { DatabaseAdapter, DatabaseRunResult } from './index.mjs';

export type SqlDialect = 'sqlite' | 'mysql' | 'postgresql';
export type SqlQuery = { query: string; values: unknown[] };
type SqlValue = unknown;
type Values = Record<string, SqlValue | undefined>;
type InsertSelectValue = SqlValue | { column: string };

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const quoteIdentifier = (identifier: string, dialect: SqlDialect) => {
	const parts = identifier.split('.');
	if (!parts.every((part) => identifierPattern.test(part))) throw new Error(`Unsafe SQL identifier: ${identifier}`);
	return parts.map((part) => dialect === 'mysql' ? `\`${part}\`` : `"${part}"`).join('.');
};

const dialectOf = (database: DatabaseAdapter): SqlDialect => database.dialect ?? 'sqlite';
const definedEntries = (values: Values) => Object.entries(values).filter((entry): entry is [string, SqlValue] => entry[1] !== undefined);

export type SqlCondition = { column: string; value?: SqlValue; operator?: '=' | '!=' | '<' | '<=' | '>' | '>=' | 'IS NULL' | 'IS NOT NULL' };
export type SqlJoin = { type?: 'INNER' | 'LEFT'; table: string; alias?: string; left: string; right: string };
export type SqlColumn = string | { column: string; cast?: 'text' };
export type SqlSelectOptions = { table: string; alias?: string; distinct?: boolean; columns?: Record<string, SqlColumn>; includeAll?: boolean; sqliteRowIdAlias?: string; joins?: SqlJoin[]; where?: SqlCondition[]; orderBy?: Array<{ column: string; direction?: 'ASC' | 'DESC' }>; limit?: number; offset?: number };

export abstract class SqlBuilder {
	constructor(readonly dialect: SqlDialect) {}
	protected abstract placeholder(index: number): string;
	protected placeholders(count: number, start = 1) { return Array.from({ length: count }, (_, index) => this.placeholder(start + index)); }

	select(options: SqlSelectOptions): SqlQuery {
		const selectedColumns = options.columns && Object.keys(options.columns).length
			? Object.entries(options.columns).map(([alias, definition]) => {
				const column = typeof definition === 'string' ? quoteIdentifier(definition, this.dialect) : definition.cast === 'text' ? this.castText(definition.column) : quoteIdentifier(definition.column, this.dialect);
				return `${column} AS ${quoteIdentifier(alias, this.dialect)}`;
			})
			: [];
		if (options.sqliteRowIdAlias) {
			if (this.dialect !== 'sqlite') throw new Error('rowid is only available for SQLite');
			selectedColumns.unshift(`rowid AS ${quoteIdentifier(options.sqliteRowIdAlias, this.dialect)}`);
		}
		if (options.includeAll || !selectedColumns.length) selectedColumns.push('*');
		const columns = selectedColumns.join(', ');
		let query = `SELECT${options.distinct ? ' DISTINCT' : ''} ${columns} FROM ${quoteIdentifier(options.table, this.dialect)}${options.alias ? ` AS ${quoteIdentifier(options.alias, this.dialect)}` : ''}`;
		for (const join of options.joins ?? []) query += ` ${join.type ?? 'INNER'} JOIN ${quoteIdentifier(join.table, this.dialect)}${join.alias ? ` AS ${quoteIdentifier(join.alias, this.dialect)}` : ''} ON ${quoteIdentifier(join.left, this.dialect)} = ${quoteIdentifier(join.right, this.dialect)}`;
		const conditions = options.where ?? [], boundConditions = conditions.filter((condition) => !['IS NULL', 'IS NOT NULL'].includes(condition.operator ?? ''));
		let parameterIndex = 0;
		if (conditions.length) query += ` WHERE ${conditions.map((condition) => {
			const operator = condition.operator ?? '=';
			return ['IS NULL', 'IS NOT NULL'].includes(operator) ? `${quoteIdentifier(condition.column, this.dialect)} ${operator}` : `${quoteIdentifier(condition.column, this.dialect)} ${operator} ${this.placeholder(++parameterIndex)}`;
		}).join(' AND ')}`;
		if (options.orderBy?.length) query += ` ORDER BY ${options.orderBy.map((order) => `${quoteIdentifier(order.column, this.dialect)} ${order.direction ?? 'ASC'}`).join(', ')}`;
		if (options.limit !== undefined) { query += ` LIMIT ${this.placeholder(boundConditions.length + 1)}`; if (options.offset !== undefined) query += ` OFFSET ${this.placeholder(boundConditions.length + 2)}`; }
		return { query, values: [...boundConditions.map((condition) => condition.value as SqlValue), ...(options.limit !== undefined ? [options.limit, ...(options.offset !== undefined ? [options.offset] : [])] : [])] };
	}

	count(table: string, where: SqlCondition[] = []): SqlQuery {
		let query = `SELECT COUNT(*) AS ${quoteIdentifier('count', this.dialect)} FROM ${quoteIdentifier(table, this.dialect)}`;
		let parameterIndex = 0;
		if (where.length) query += ` WHERE ${where.map((condition) => {
			const operator = condition.operator ?? '=';
			return ['IS NULL', 'IS NOT NULL'].includes(operator) ? `${quoteIdentifier(condition.column, this.dialect)} ${operator}` : `${quoteIdentifier(condition.column, this.dialect)} ${operator} ${this.placeholder(++parameterIndex)}`;
		}).join(' AND ')}`;
		return { query, values: where.filter((condition) => !['IS NULL', 'IS NOT NULL'].includes(condition.operator ?? '')).map((condition) => condition.value) };
	}

	insert(table: string, values: Values): SqlQuery {
		const entries = definedEntries(values); if (!entries.length) throw new Error('INSERT values cannot be empty');
		return {
			query: `INSERT INTO ${quoteIdentifier(table, this.dialect)} (${entries.map(([key]) => quoteIdentifier(key, this.dialect)).join(', ')}) VALUES (${this.placeholders(entries.length).join(', ')})`,
			values: entries.map(([, value]) => value),
		};
	}

	insertFromSelect(table: string, values: Record<string, InsertSelectValue>, from: string, where: SqlCondition[]): SqlQuery {
		const entries = Object.entries(values); if (!entries.length || !where.length) throw new Error('insertFromSelect values and where cannot be empty');
		let parameterIndex = 0;
		const selected = entries.map(([, value]) => value && typeof value === 'object' && 'column' in value
			? quoteIdentifier(String(value.column), this.dialect)
			: this.placeholder(++parameterIndex));
		const conditions = where.map((condition) => {
			const operator = condition.operator ?? '=';
			return ['IS NULL', 'IS NOT NULL'].includes(operator) ? `${quoteIdentifier(condition.column, this.dialect)} ${operator}` : `${quoteIdentifier(condition.column, this.dialect)} ${operator} ${this.placeholder(++parameterIndex)}`;
		});
		return {
			query: `INSERT INTO ${quoteIdentifier(table, this.dialect)} (${entries.map(([key]) => quoteIdentifier(key, this.dialect)).join(', ')}) SELECT ${selected.join(', ')} FROM ${quoteIdentifier(from, this.dialect)} WHERE ${conditions.join(' AND ')}`,
			values: [...entries.filter(([, value]) => !(value && typeof value === 'object' && 'column' in value)).map(([, value]) => value), ...where.filter((condition) => !['IS NULL', 'IS NOT NULL'].includes(condition.operator ?? '')).map((condition) => condition.value)],
		};
	}

	update(table: string, values: Values, where: Values | SqlCondition[]): SqlQuery {
		const entries = definedEntries(values), conditions: SqlCondition[] = Array.isArray(where) ? where : definedEntries(where).map(([column, value]) => ({ column, value }));
		if (!entries.length || !conditions.length) throw new Error('UPDATE values and where cannot be empty');
		let parameterIndex = entries.length;
		return {
			query: `UPDATE ${quoteIdentifier(table, this.dialect)} SET ${entries.map(([key], index) => `${quoteIdentifier(key, this.dialect)} = ${this.placeholder(index + 1)}`).join(', ')} WHERE ${conditions.map((condition) => {
				const operator = condition.operator ?? '=';
				return ['IS NULL', 'IS NOT NULL'].includes(operator) ? `${quoteIdentifier(condition.column, this.dialect)} ${operator}` : `${quoteIdentifier(condition.column, this.dialect)} ${operator} ${this.placeholder(++parameterIndex)}`;
			}).join(' AND ')}`,
			values: [...entries.map(([, value]) => value), ...conditions.filter((condition) => !['IS NULL', 'IS NOT NULL'].includes(condition.operator ?? '')).map((condition) => condition.value as SqlValue)],
		};
	}

	delete(table: string, where: Values): SqlQuery {
		const conditions = definedEntries(where); if (!conditions.length) throw new Error('DELETE where cannot be empty');
		return { query: `DELETE FROM ${quoteIdentifier(table, this.dialect)} WHERE ${conditions.map(([key], index) => `${quoteIdentifier(key, this.dialect)} = ${this.placeholder(index + 1)}`).join(' AND ')}`, values: conditions.map(([, value]) => value) };
	}

	advanceNumber(table: string, column: string, floor: number, updatedAt: number, where: Values): SqlQuery {
		const conditions = definedEntries(where); if (!conditions.length) throw new Error('advanceNumber where cannot be empty');
		const target = quoteIdentifier(column, this.dialect), greatest = this.dialect === 'sqlite' ? 'MAX' : 'GREATEST';
		return {
			query: `UPDATE ${quoteIdentifier(table, this.dialect)} SET ${target} = ${greatest}(${target} + 1, ${this.placeholder(1)}), ${quoteIdentifier('updated_at', this.dialect)} = ${this.placeholder(2)} WHERE ${conditions.map(([key], index) => `${quoteIdentifier(key, this.dialect)} = ${this.placeholder(index + 3)}`).join(' AND ')}`,
			values: [floor, updatedAt, ...conditions.map(([, value]) => value)],
		};
	}

	upsert(table: string, conflictKeys: string[], values: Values, updateKeys: string[]): SqlQuery {
		const inserted = this.insert(table, values), quotedUpdates = updateKeys.map((key) => quoteIdentifier(key, this.dialect));
		if (!conflictKeys.length || !quotedUpdates.length) throw new Error('UPSERT conflict and update keys cannot be empty');
		const suffix = this.dialect === 'mysql'
			? ` ON DUPLICATE KEY UPDATE ${quotedUpdates.map((key) => `${key} = VALUES(${key})`).join(', ')}`
			: ` ON CONFLICT (${conflictKeys.map((key) => quoteIdentifier(key, this.dialect)).join(', ')}) DO UPDATE SET ${quotedUpdates.map((key) => `${key} = excluded.${key}`).join(', ')}`;
		return { ...inserted, query: inserted.query + suffix };
	}

	ignoreInsert(table: string, conflictKeys: string[], values: Values): SqlQuery {
		const inserted = this.insert(table, values);
		return this.dialect === 'mysql'
			? { ...inserted, query: inserted.query.replace(/^INSERT /, 'INSERT IGNORE ') }
			: { ...inserted, query: `${inserted.query} ON CONFLICT (${conflictKeys.map((key) => quoteIdentifier(key, this.dialect)).join(', ')}) DO NOTHING` };
	}

	castText(expression: string) { const quoted = quoteIdentifier(expression, this.dialect); return this.dialect === 'mysql' ? `CAST(${quoted} AS CHAR)` : `CAST(${quoted} AS TEXT)`; }
}

export class SqliteSqlBuilder extends SqlBuilder { constructor() { super('sqlite'); } protected placeholder() { return '?'; } }
export class MysqlSqlBuilder extends SqlBuilder { constructor() { super('mysql'); } protected placeholder() { return '?'; } }
export class PostgresqlSqlBuilder extends SqlBuilder { constructor() { super('postgresql'); } protected placeholder(index: number) { return `$${index}`; } }

export const sql = (database: DatabaseAdapter) => {
	const dialect = dialectOf(database);
	return dialect === 'mysql' ? new MysqlSqlBuilder() : dialect === 'postgresql' ? new PostgresqlSqlBuilder() : new SqliteSqlBuilder();
};
export const runSql = (database: DatabaseAdapter, statement: SqlQuery): Promise<DatabaseRunResult> => database.prepare(statement.query).bind(...statement.values).run();
export const firstSql = <T,>(database: DatabaseAdapter, statement: SqlQuery) => database.prepare(statement.query).bind(...statement.values).first<T>();
export const allSql = async <T,>(database: DatabaseAdapter, statement: SqlQuery) => (await database.prepare(statement.query).bind(...statement.values).all<T>()).results;
export { compileSqlPlaceholders } from './placeholders.mjs';
