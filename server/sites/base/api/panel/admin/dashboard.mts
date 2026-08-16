import type { ApiHandler } from '@server/api-router.mjs';
import { apiResponse } from '@server/api-response.mjs';
import { mockTables } from '@server/panel-data.mjs';

const handler: ApiHandler = (c) => {
	const rows = mockTables.rows.rows;
	const enabledRows = rows.filter((row) => row.status === 'enabled').length;
	return apiResponse(c, 200, {
		dashboard: {
			recentTitle: '最近数据',
			statistics: [
				{ key: 'columns', label: '字段定义', value: mockTables.columns.rows.length },
				{ key: 'rows', label: '数据记录', value: rows.length },
				{ key: 'enabledRows', label: '启用记录', value: enabledRows },
			],
			recentColumns: mockTables.rows.columns,
			recentRows: rows.slice(-5).reverse(),
		},
	});
};

export default handler;
