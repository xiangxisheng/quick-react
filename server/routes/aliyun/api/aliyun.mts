import type { ApiHandler } from '@server/modules/base/api-router.mjs';

const handler: ApiHandler = async (_c, next) => next();

export default handler;
