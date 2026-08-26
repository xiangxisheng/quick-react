import type { ApiHandler } from '@server/api-router.mjs';
import businessPassportSign from '@server/passport/business-sign.mjs';

const handler: ApiHandler = (c, next) => businessPassportSign(c, next, {});

export default handler;
