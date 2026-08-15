import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
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

const getMockTable = (resource: string) => mockTables[resource];

const parseJsonBody = async (c: Context<AppEnv>) => {
	try {
		return await c.req.json<Record<string, unknown>>();
	} catch {
		return {};
	}
};

const getMockTableResponse = (table: MockTable, pageNum: number, pageSize: number) => {
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

const mockTablePath = '/api/panel/data/:resource';

export const registerPanelRoutes = (app: Hono<AppEnv>) => {
	app.get(mockTablePath, (c) => {
		const table = getMockTable(c.req.param('resource'));
		if (!table) return c.json({ message: '模拟数据表不存在' }, 404);
		const pageNum = Math.max(1, Number(c.req.query('pageNum')) || 1);
		const pageSize = Math.max(1, Number(c.req.query('pageSize')) || 10);
		return c.json(getMockTableResponse(table, pageNum, pageSize));
	});

	app.get(`${mockTablePath}/:id`, (c) => {
		const table = getMockTable(c.req.param('resource'));
		const row = table?.rows.find((item) => item.key === c.req.param('id'));
		if (!row) return c.json({ message: '模拟数据不存在' }, 404);
		return c.json(row);
	});

	app.get('/api/panel/dashboard', (c) => {
		const rows = mockTables.rows.rows;
		const enabledRows = rows.filter((row) => row.status === 'enabled').length;
		return c.json({
			dashboard: {
				title: '管理后台',
				statistics: [
					{ key: 'columns', label: '字段定义', value: mockTables.columns.rows.length },
					{ key: 'rows', label: '数据记录', value: rows.length },
					{ key: 'enabledRows', label: '启用记录', value: enabledRows },
				],
				recentRows: rows.slice(-5).reverse(),
			},
		});
	});

	app.post(mockTablePath, async (c) => {
		const table = getMockTable(c.req.param('resource'));
		if (!table) return c.json({ message: '模拟数据表不存在' }, 404);
		const body = await parseJsonBody(c);
		const row = { ...body, key: String(body.key || randomUUID()) } as MockRow;
		table.rows.push(row);
		return c.json({ message: '新增成功', data: row }, 201);
	});

	app.put(`${mockTablePath}/:id`, async (c) => {
		const table = getMockTable(c.req.param('resource'));
		const index = table?.rows.findIndex((item) => item.key === c.req.param('id')) ?? -1;
		if (!table || index < 0) return c.json({ message: '模拟数据不存在' }, 404);
		const body = await parseJsonBody(c);
		table.rows[index] = { ...table.rows[index], ...body, key: table.rows[index].key };
		return c.json({ message: '保存成功', data: table.rows[index] });
	});

	app.delete(mockTablePath, async (c) => {
		const table = getMockTable(c.req.param('resource'));
		if (!table) return c.json({ message: '模拟数据表不存在' }, 404);
		const body = await c.req.json<unknown>().catch(() => []);
		const ids = Array.isArray(body) ? body.map(String) : [];
		table.rows = table.rows.filter((row) => !ids.includes(row.key));
		return c.json({ message: '删除成功' });
	});
};
