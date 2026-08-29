import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiResponse } from '@server/modules/base/api-response.mjs';
import { mockTables } from '@server/modules/base/panel-data.mjs';
import type { DashboardData } from '@shared/types/dashboard.mjs';

const handler: ApiHandler = (c) => {
	const rows = mockTables.rows.rows;
	const enabledRows = rows.filter((row) => row.status === 'enabled').length;
	const dashboard: DashboardData = {
			recentTitle: '最近数据',
			statistics: [
				{ key: 'columns', label: '字段定义', value: mockTables.columns.rows.length },
				{ key: 'rows', label: '数据记录', value: rows.length },
				{ key: 'enabledRows', label: '启用记录', value: enabledRows },
			],
			recentColumns: mockTables.rows.columns,
			recentRows: rows.slice(-5).reverse(),
	};
	return apiResponse(c, 200, { dashboard });
};

export default handler;
