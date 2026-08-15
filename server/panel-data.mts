import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import type { AppEnv, MockRow, MockTable } from './types.mjs';

export const mockTables: Record<string, MockTable> = {
	columns: {
		columns: [
			{ dataIndex: 'key', title: '标识' },
			{ dataIndex: 'dataIndex', title: '字段名' },
			{ dataIndex: 'title', title: '标题' },
			{ dataIndex: 'component', title: '表单组件' },
			{ dataIndex: 'dataType', title: '数据类型' },
		],
		rows: [
			{ key: 'column-1', dataIndex: 'name', title: '名称', component: 'textbox', dataType: 'string' },
			{ key: 'column-2', dataIndex: 'status', title: '状态', component: 'select', dataType: 'string' },
			{ key: 'column-3', dataIndex: 'createdAt', title: '创建时间', component: 'datepicker', dataType: 'datetime' },
		],
	},
	rows: {
		columns: [
			{ dataIndex: 'key', title: '标识' },
			{ dataIndex: 'name', title: '名称', component: 'textbox', dataType: 'string' },
			{ dataIndex: 'status', title: '状态', component: 'select', dataType: 'string' },
			{ dataIndex: 'createdAt', title: '创建时间', component: 'datepicker', dataType: 'datetime', dayjsFormat: 'YYYY-MM-DD HH:mm:ss' },
		],
		rows: [
			{ key: 'row-1', name: '示例数据一', status: 'enabled', createdAt: '2026-01-01T08:00:00.000Z' },
			{ key: 'row-2', name: '示例数据二', status: 'disabled', createdAt: '2026-01-02T08:00:00.000Z' },
			{ key: 'row-3', name: '示例数据三', status: 'enabled', createdAt: '2026-01-03T08:00:00.000Z' },
		],
	},
};

export const getMockTable = (resource: string) => mockTables[resource];

export const parseJsonBody = async (c: Context<AppEnv>) => {
	try {
		return await c.req.json<Record<string, unknown>>();
	} catch {
		return {};
	}
};

export const getMockTableResponse = (table: MockTable, pageNum: number, pageSize: number) => {
	const start = Math.max(0, (pageNum - 1) * pageSize);
	return {
		table: {
			option: { rowKey: 'key' },
			columns: table.columns,
			dataSource: table.rows.slice(start, start + pageSize),
			totalRecords: table.rows.length,
		},
	};
};

export const addRow = (table: MockTable, body: Record<string, unknown>) => {
	const row = { ...body, key: String(body.key || randomUUID()) } as MockRow;
	table.rows.push(row);
	return row;
};
