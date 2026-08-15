import type { ApiHandler } from '@server/api-router.mjs';

const handler: ApiHandler = (c) => c.json({
	dashboard: {
		title: '阿里云管理',
		statistics: [],
		recentColumns: [],
		recentRows: [],
	},
});

export default handler;
