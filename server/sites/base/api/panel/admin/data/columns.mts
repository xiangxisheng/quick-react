import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/modules/base/api-response.mjs';
import { addColumn, databaseTypeOptions, dropColumn, renameColumn } from '@server/database/schema.mjs';
import { runSql } from '@server/database/sql.mjs';
import { assertTable, databaseQueryFields, databaseTableActions, getColumns, readTable } from '@server/sites/base/data/database-table.mjs';
import { getChangedFields } from '@server/modules/base/changed-fields.mjs';

const readBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
const columnName = (value: unknown) => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : '';
const columnType = (value: unknown) => typeof value === 'string' ? value.trim().toUpperCase() : '';

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
		if (c.req.method === 'POST') {
			const body = await readBody(c);
			const name = columnName(body.name);
			const type = columnType(body.type) || 'TEXT';
			if (!name) return apiMessage(c, 400, '字段名必须是字母、数字或下划线，且不能以数字开头');
			const notnull = body.notnull === true || body.notnull === 1 || body.notnull === '1';
			const defaultValue = body.defaultValue ?? body.default;
			if (notnull && defaultValue === undefined) return apiMessage(c, 400, '新增必填字段时必须提供默认值');
			try { await runSql(database, addColumn(database, tableName, name, type, notnull, defaultValue)); }
			catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '新增字段失败'); }
			return apiMessageData(c, 201, '新增字段成功', {});
		}
		if (c.req.method === 'PUT' && params.id) {
			const body = await readBody(c);
			const changedFields = getChangedFields(body, ['name', 'type']);
			const current = (await getColumns(database, tableName)).find((column) => column.name === params.id);
			if (!current) return apiMessage(c, 404, '字段不存在');
			if (changedFields.has('type') && columnType(body.type) !== (current.type || 'TEXT').toUpperCase()) {
				return apiMessage(c, 400, '通用数据管理不支持直接修改字段类型，请通过数据库迁移执行');
			}
			if (!changedFields.has('name')) return apiMessage(c, 200, '字段未修改');
			const name = columnName(body.name);
			if (!name) return apiMessage(c, 400, '新字段名无效');
			try { await runSql(database, renameColumn(database, tableName, params.id, name)); }
			catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '重命名字段失败'); }
			return apiMessage(c, 200, '字段保存成功');
		}
		if (c.req.method === 'DELETE') {
			const ids = await c.req.json<unknown>().catch(() => []);
			if (!Array.isArray(ids) || !ids.length) return apiMessage(c, 400, '请选择要删除的字段');
			const columns = await getColumns(database, tableName);
			if (ids.length >= columns.length) return apiMessage(c, 400, '不能删除数据表的全部字段');
			try {
				for (const id of ids) await runSql(database, dropColumn(database, tableName, String(id)));
			} catch (error) { return apiMessage(c, 400, error instanceof Error ? error.message : '删除字段失败'); }
			return apiMessage(c, 200, '字段删除成功');
		}
		return next();
	}
	const result = await readTable(c.get('database'), 'columns', c.req.query('table'), c.req.query('pageNum'), c.req.query('pageSize'));
	const { tables, editable: _, ...table } = result;
	return apiResponse(c, 200, { table: { ...table, option: { rowKey: 'key', actions: databaseTableActions(true), queryFields: databaseQueryFields(database, site.databaseTarget.kind === 'binding', tables) }, columns: [
		{ dataIndex: 'name', title: '字段名', component: 'textbox' },
		{ dataIndex: 'type', title: '类型', component: 'select', options: databaseTypeOptions(database) },
		{ dataIndex: 'notnull', title: '必填', component: 'switch' },
		{ dataIndex: 'pk', title: '主键', component: 'switch' },
	] } });
};

export const acceptsTrailingParams = true;
export default handler;
