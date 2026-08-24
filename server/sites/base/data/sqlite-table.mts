import type { DatabaseAdapter } from '@server/database/index.mjs';
import type { TableAction, TableColumn, TableData, TableResponse } from '@shared/types/table.mjs';

type SqliteTable = { name: string };
type SqliteInfo = { name: string; type: string; notnull: number; pk: number };
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const page = (value: string | undefined, fallback: number) => Math.max(1, Number(value) || fallback);
export const getTables = async (database: DatabaseAdapter) => {
	const result = await database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all<SqliteTable>();
	return result.results.map((item) => ({ value: item.name, text: item.name }));
};
export const getColumns = async (database: DatabaseAdapter, tableName: string) => database.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all<SqliteInfo>().then((result) => result.results);
export const databaseOptions = (label: string) => [{ value: 'current', text: label }];
export const sqliteTypeOptions = [
	{ value: 'TEXT', text: 'TEXT' },
	{ value: 'INTEGER', text: 'INTEGER' },
	{ value: 'REAL', text: 'REAL' },
	{ value: 'NUMERIC', text: 'NUMERIC' },
	{ value: 'BLOB', text: 'BLOB' },
];
export const sqliteTableActions: { toolbarActions: TableAction[]; rowActions: TableAction[] } = {
	toolbarActions: [
		{ key: 'create', label: '新增', action: 'create' },
		{ key: 'delete', label: '删除', action: 'delete', confirm: '确定删除所选记录吗？' },
	],
	rowActions: [
		{ key: 'edit', label: '编辑', action: 'edit' },
		{ key: 'delete', label: '删除', action: 'delete', confirm: '确定删除这条记录吗？' },
	],
};
const tableColumn = (column: SqliteInfo): TableColumn => ({ dataIndex: column.name, title: column.name, component: 'textbox', dataType: /INT/i.test(column.type) ? 'int' : /REAL|FLOA|DOUB/i.test(column.type) ? 'float' : 'string' });
export const readTable = async (database: DatabaseAdapter, mode: 'columns' | 'rows', tableName: string | undefined, pageNumValue?: string, pageSizeValue?: string): Promise<TableResponse> => {
	const tables = await getTables(database);
	if (!tableName || !tables.some((item) => item.value === tableName)) return { tables, dataSource: [], totalRecords: 0, option: { rowKey: 'rowid' } };
	const info = await getColumns(database, tableName);
	if (mode === 'columns') {
		const rows = info.map((column) => ({ key: column.name, cid: column.name, name: column.name, type: column.type || '—', notnull: Boolean(column.notnull), pk: Boolean(column.pk) }));
		return { tables, columns: [{ dataIndex: 'cid', title: '字段名', component: 'textbox' }, { dataIndex: 'type', title: '类型', component: 'textbox' }, { dataIndex: 'notnull', title: '必填', component: 'switch' }, { dataIndex: 'pk', title: '主键', component: 'switch' }], dataSource: rows, totalRecords: rows.length, option: { rowKey: 'key' } };
	}
	const rowKey = info.find((column) => column.pk)?.name ?? 'rowid';
	const pageNum = page(pageNumValue, 1), pageSize = page(pageSizeValue, 10), quotedTable = quoteIdentifier(tableName);
	const total = await database.prepare(`SELECT COUNT(*) AS count FROM ${quotedTable}`).first<{ count: number }>();
	const rows = await database.prepare(`SELECT rowid AS __rowid__, * FROM ${quotedTable} LIMIT ?1 OFFSET ?2`).bind(pageSize, (pageNum - 1) * pageSize).all<TableData>();
	const dataSource = rows.results.map((row) => ({ ...row, key: String(row[rowKey] ?? row.__rowid__) }));
	return { tables, columns: info.map(tableColumn), dataSource, totalRecords: Number(total?.count ?? 0), option: { rowKey: 'key' } };
};
export const assertTable = async (database: DatabaseAdapter, tableName: string) => { if (!(await getTables(database)).some((item) => item.value === tableName)) throw new Error('数据表不存在'); };
export const tableIdentifier = quoteIdentifier;
