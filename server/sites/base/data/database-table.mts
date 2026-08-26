import type { DatabaseAdapter } from '@server/database/index.mjs';
import { databaseLabel, listColumns, listTables } from '@server/database/schema.mjs';
import { allSql, firstSql, sql } from '@server/database/sql.mjs';
import type { TableActions, TableColumn, TableData, TableResponse, TableSelectOption } from '@shared/types/table.mjs';

const page = (value: string | undefined, fallback: number) => Math.max(1, Number(value) || fallback);
export const getTables = async (database: DatabaseAdapter) => (await listTables(database)).map((item) => ({ value: item.name, text: item.name }));
export const getColumns = listColumns;
export const databaseOptions = (label: string) => [{ value: 'current', text: label }];
export const databaseQueryFields = (database: DatabaseAdapter, binding: boolean, tables: { value: string; text: string }[]) => [
	{ dataIndex: 'database', label: '数据库', component: 'select' as const, defaultValue: 'current', options: databaseOptions(databaseLabel(database, binding)) },
	{ dataIndex: 'table', label: '数据表', component: 'select' as const, placeholder: '选择数据表', options: tables, defaultValue: tables[0]?.value },
];
export const databaseTableActions = (editable: boolean): TableActions => ({
	toolbar: editable ? [
		{ key: 'create', label: '新增' },
		{ key: 'delete', label: '删除', confirm: '确定删除所选记录吗？' },
	] : [],
	query: [{ key: 'search', label: '搜索' }],
	row: editable ? [
		{ key: 'edit', label: '编辑' },
		{ key: 'delete', label: '删除', confirm: '确定删除这条记录吗？' },
	] : [],
});
export type DatabaseTableResponse = TableResponse & { tables: TableSelectOption[]; editable: boolean };
const tableColumn = (column: Awaited<ReturnType<typeof getColumns>>[number]): TableColumn => ({ dataIndex: column.name, title: column.name, component: 'textbox', dataType: /INT/i.test(column.type) ? 'int' : /REAL|FLOA|DOUB|DECIMAL|NUMERIC/i.test(column.type) ? 'float' : 'string' });
export const readTable = async (database: DatabaseAdapter, mode: 'columns' | 'rows', tableName: string | undefined, pageNumValue?: string, pageSizeValue?: string): Promise<DatabaseTableResponse> => {
	const tables = await getTables(database);
	const selectedTableName = tableName || tables[0]?.value;
	if (!selectedTableName || !tables.some((item) => item.value === selectedTableName)) return { tables, editable: false, dataSource: [], totalRecords: 0, option: { rowKey: 'key' } };
	const info = await getColumns(database, selectedTableName);
	if (mode === 'columns') {
		const rows = info.map((column) => ({ key: column.name, cid: column.name, name: column.name, type: column.type || '—', notnull: Boolean(column.notnull), pk: Boolean(column.pk) }));
		return { tables, editable: true, columns: [{ dataIndex: 'cid', title: '字段名', component: 'textbox' }, { dataIndex: 'type', title: '类型', component: 'textbox' }, { dataIndex: 'notnull', title: '必填', component: 'switch' }, { dataIndex: 'pk', title: '主键', component: 'switch' }], dataSource: rows, totalRecords: rows.length, option: { rowKey: 'key' } };
	}
	const primaryKey = info.find((column) => column.pk)?.name;
	const sqliteRowId = !primaryKey && (database.dialect ?? 'sqlite') === 'sqlite';
	const rowKey = primaryKey ?? (sqliteRowId ? '__rowid__' : '');
	const pageNum = page(pageNumValue, 1), pageSize = page(pageSizeValue, 10);
	const total = await firstSql<{ count: number | string }>(database, sql(database).count(selectedTableName));
	const rows = await allSql<TableData>(database, sql(database).select({ table: selectedTableName, includeAll: true, sqliteRowIdAlias: sqliteRowId ? '__rowid__' : undefined, limit: pageSize, offset: (pageNum - 1) * pageSize }));
	const dataSource = rows.map((row, index) => ({ ...row, key: rowKey ? String(row[rowKey]) : `readonly-${(pageNum - 1) * pageSize + index + 1}` }));
	const dataColumns = info.map(tableColumn);
	const idIndex = dataColumns.findIndex((column) => column.dataIndex === 'id');
	if (idIndex > 0) dataColumns.unshift(dataColumns.splice(idIndex, 1)[0]);
	if (sqliteRowId) dataColumns.unshift({ dataIndex: '__rowid__', title: 'ID', dataType: 'int' });
	return { tables, editable: Boolean(rowKey), columns: dataColumns, dataSource, totalRecords: Number(total?.count ?? 0), option: { rowKey: 'key' } };
};
export const assertTable = async (database: DatabaseAdapter, tableName: string) => { if (!(await getTables(database)).some((item) => item.value === tableName)) throw new Error('数据表不存在'); };
export const tableRowKey = (database: DatabaseAdapter, columns: Awaited<ReturnType<typeof getColumns>>) => {
	const primaryKey = columns.find((column) => column.pk)?.name;
	if (primaryKey) return primaryKey;
	if ((database.dialect ?? 'sqlite') === 'sqlite') return 'rowid';
	throw new Error('该表没有主键，在 MySQL/PostgreSQL 中只能查看，不能编辑或删除');
};
