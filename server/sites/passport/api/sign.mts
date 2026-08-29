import type { ApiHandler } from '@server/api-router.mjs';
import baseSign from '@server/sites/base/api/sign.mjs';

/** Passport 作为站点时与其它站点完全共用 Base 登录入口。 */
const handler: ApiHandler = (c, next, params) => baseSign(c, next, params);

export default handler;
