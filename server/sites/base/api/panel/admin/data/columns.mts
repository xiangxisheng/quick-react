import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { addRow, getMockTable, getMockTableResponse, parseJsonBody } from '@server/panel-data.mjs';

const table = () => getMockTable('columns');

const handler: ApiHandler = async (c, next, params) => {
	const currentTable = table();
	if (!currentTable) return apiMessage(c, 404, '模拟数据表不存在');
	if (params.id) {
		const row = currentTable.rows.find((item) => item.key === params.id);
		if (c.req.method === 'GET') return row ? c.json(row) : c.json({ message: '模拟数据不存在' }, 404);
		if (c.req.method === 'PUT') {
			if (!row) return apiMessage(c, 404, '模拟数据不存在');
			const body = await parseJsonBody(c);
			Object.assign(row, body, { key: row.key });
		return apiMessageData(c, 200, '保存成功', { data: row });
		}
		return next();
	}
	if (c.req.method === 'GET') {
		const pageNum = Math.max(1, Number(c.req.query('pageNum')) || 1);
		const pageSize = Math.max(1, Number(c.req.query('pageSize')) || 10);
		return apiResponse(c, 200, getMockTableResponse(currentTable, pageNum, pageSize));
	}
	if (c.req.method === 'POST') return apiMessageData(c, 201, '新增成功', { data: addRow(currentTable, await parseJsonBody(c)) });
	if (c.req.method === 'DELETE') {
		const body = await c.req.json<unknown>().catch(() => []);
		const ids = Array.isArray(body) ? body.map(String) : [];
		currentTable.rows = currentTable.rows.filter((row) => !ids.includes(row.key));
		return apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
