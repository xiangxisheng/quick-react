import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { assertTable, getColumns, readTable, sqliteQueryFields, sqliteTableActions, tableIdentifier } from '@server/sites/base/data/sqlite-table.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';

const body = async (c: Parameters<ApiHandler>[0]) => c.req.json<Record<string, unknown>>().catch(() => ({}));
const editableFields = (values: Record<string, unknown>, names: Set<string>) => Object.entries(values).filter(([name]) => names.has(name));

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	const tableName = c.req.query('table');
	if (params.id && c.req.method === 'GET' && tableName) {
		try { await assertTable(database, tableName); } catch { return apiMessage(c, 404, '数据表不存在'); }
		const info = await getColumns(database, tableName);
		const rowKey = info.find((column) => column.pk)?.name ?? 'rowid';
		const row = await database.prepare(`SELECT rowid AS __rowid__, * FROM ${tableIdentifier(tableName)} WHERE ${tableIdentifier(rowKey)} = ?1`).bind(params.id).first<Record<string, unknown>>();
		return row ? apiResponse(c, 200, row) : apiMessage(c, 404, '数据不存在');
	}
	if (c.req.method === 'GET') {
		const result = await readTable(database, 'rows', tableName, c.req.query('pageNum'), c.req.query('pageSize'));
		const site = c.get('site');
		const { tables, ...table } = result;
		return apiResponse(c, 200, { table: { ...table, option: { ...table.option, ...sqliteTableActions, queryFields: sqliteQueryFields(`${site.databaseTarget.kind === 'binding' ? 'D1' : 'SQLite'}（当前）`, tables) } } });
	}
	if (!tableName) return apiMessage(c, 400, '请选择数据表');
	try { await assertTable(database, tableName); } catch { return apiMessage(c, 404, '数据表不存在'); }
	const info = await getColumns(database, tableName);
	const names = new Set(info.map((column) => column.name));
	const rowKey = info.find((column) => column.pk)?.name ?? 'rowid';
	const table = tableIdentifier(tableName);
	if (params.id && c.req.method === 'PUT') {
		const source = await body(c);
		const changedFields = getChangedFields(source, [...names]);
		const values = editableFields(source, changedFields);
		if (!values.length) return apiMessage(c, 400, '没有可更新的字段');
		const set = values.map(([name], index) => `${tableIdentifier(name)} = ?${index + 1}`).join(', ');
		await database.prepare(`UPDATE ${table} SET ${set} WHERE ${tableIdentifier(rowKey)} = ?${values.length + 1}`).bind(...values.map(([, value]) => value), params.id).run();
		return apiMessage(c, 200, '保存成功');
	}
	if (c.req.method === 'POST') {
		const values = editableFields(await body(c), names);
		if (!values.length) return apiMessage(c, 400, '没有可写入的字段');
		const fields = values.map(([name]) => tableIdentifier(name)).join(', ');
		const marks = values.map((_, index) => `?${index + 1}`).join(', ');
		await database.prepare(`INSERT INTO ${table} (${fields}) VALUES (${marks})`).bind(...values.map(([, value]) => value)).run();
		return apiMessageData(c, 201, '新增成功', {});
	}
	if (c.req.method === 'DELETE') {
		const ids = await c.req.json<unknown>().catch(() => []);
		if (!Array.isArray(ids)) return apiMessage(c, 400, '删除参数无效');
		for (const id of ids) await database.prepare(`DELETE FROM ${table} WHERE ${tableIdentifier(rowKey)} = ?1`).bind(String(id)).run();
		return apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
