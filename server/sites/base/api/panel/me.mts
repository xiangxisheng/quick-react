import type { ApiHandler } from '@server/api-router.mjs';
import { apiResponse } from '@server/api-response.mjs';

const handler: ApiHandler = (c, next) => {
	if (c.req.method === 'GET') return apiResponse(c, 200, { user: c.get('currentUser') });
	return next();
};

export default handler;
