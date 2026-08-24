import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { assertTable, databaseOptions, getColumns, readTable, sqliteTypeOptions, tableIdentifier } from '@server/sites/base/data/sqlite-table.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';

const readBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
const columnName = (value: unknown) => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : '';
const columnType = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_ ()]+$/.test(value.trim()) ? value.trim().toUpperCase() : '';

const handler: ApiHandler = async (c, next, params) => {
	const site = c.get('site');
	const database = c.get('database');
	const tableName = c.req.query('table');
	if (params.id && c.req.method === 'GET') {
		if (!tableName) return apiMessage(c, 400, '请选择数据表');
		const columns = await getColumns(database, tableName);
		const column = columns.find((item) => item.name === params.id);
		return column ? apiResponse(c, 200, { key: column.name, name: column.name, type: column.type || 'TEXT', notnull: Boolean(column.notnull), pk: Boolean(column.pk) }) : apiMessage(c, 404, '字段不存在');
	}
	if (c.req.method !== 'GET') {
		if (!tableName) return apiMessage(c, 400, '请选择数据表');
		try { await assertTable(database, tableName); } catch { return apiMessage(c, 404, '数据表不存在'); }
		const table = tableIdentifier(tableName);
		if (c.req.method === 'POST') {
			const body = await readBody(c);
			const name = columnName(body.name);
			const type = columnType(body.type) || 'TEXT';
			if (!name) return apiMessage(c, 400, '字段名必须是字母、数字或下划线，且不能以数字开头');
			const notnull = body.notnull === true || body.notnull === 1 || body.notnull === '1';
			const defaultValue = body.defaultValue ?? body.default;
			if (notnull && defaultValue === undefined) return apiMessage(c, 400, '新增必填字段时必须提供默认值');
			const clauses = [`${tableIdentifier(name)} ${type}`];
			if (notnull) clauses.push('NOT NULL');
			if (defaultValue !== undefined && defaultValue !== '') clauses.push(`DEFAULT ${typeof defaultValue === 'number' ? String(defaultValue) : `'${String(defaultValue).replaceAll("'", "''")}'`}`);
			try { await database.prepare(`ALTER TABLE ${table} ADD COLUMN ${clauses.join(' ')}`).run(); }
			catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '新增字段失败'); }
			return apiMessageData(c, 201, '新增字段成功', {});
		}
		if (c.req.method === 'PUT' && params.id) {
			const body = await readBody(c);
			const changedFields = getChangedFields(body, ['name', 'type']);
			const current = (await getColumns(database, tableName)).find((column) => column.name === params.id);
			if (!current) return apiMessage(c, 404, '字段不存在');
			if (changedFields.has('type') && columnType(body.type) !== (current.type || 'TEXT').toUpperCase()) {
				return apiMessage(c, 400, 'SQLite 不支持直接修改字段类型');
			}
			if (!changedFields.has('name')) return apiMessage(c, 200, '字段未修改');
			const name = columnName(body.name);
			if (!name) return apiMessage(c, 400, '新字段名无效');
			try { await database.prepare(`ALTER TABLE ${table} RENAME COLUMN ${tableIdentifier(params.id)} TO ${tableIdentifier(name)}`).run(); }
			catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '重命名字段失败'); }
			return apiMessage(c, 200, '字段保存成功');
		}
		if (c.req.method === 'DELETE') {
			const ids = await c.req.json<unknown>().catch(() => []);
			if (!Array.isArray(ids) || !ids.length) return apiMessage(c, 400, '请选择要删除的字段');
			const columns = await getColumns(database, tableName);
			if (ids.length >= columns.length) return apiMessage(c, 400, '不能删除数据表的全部字段');
			try {
				for (const id of ids) await database.prepare(`ALTER TABLE ${table} DROP COLUMN ${tableIdentifier(String(id))}`).run();
			} catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '删除字段失败'); }
			return apiMessage(c, 200, '字段删除成功');
		}
		return next();
	}
	const result = await readTable(c.get('database'), 'columns', c.req.query('table'), c.req.query('pageNum'), c.req.query('pageSize'));
	return apiResponse(c, 200, { table: { ...result, databases: databaseOptions(`${site.databaseTarget.kind === 'binding' ? 'D1' : 'SQLite'}（当前）`), database: 'current', option: { rowKey: 'key', editable: true }, columns: [
		{ dataIndex: 'name', title: '字段名', component: 'textbox' },
		{ dataIndex: 'type', title: '类型', component: 'select', options: sqliteTypeOptions },
		{ dataIndex: 'notnull', title: '必填', component: 'switch' },
		{ dataIndex: 'pk', title: '主键', component: 'switch' },
	] } });
};

export const acceptsTrailingParams = true;
export default handler;
