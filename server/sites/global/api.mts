import type { ApiHandler } from '@server/api-router.mjs';

const handler: ApiHandler = async (_c, next) => next();

export default handler;
