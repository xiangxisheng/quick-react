import type { ApiHandler } from '@server/api-router.mjs';

const handler: ApiHandler = (c) => c.json({
	dashboard: {
		recentTitle: '',
		statistics: [],
		recentColumns: [],
		recentRows: [],
	},
});

export default handler;
