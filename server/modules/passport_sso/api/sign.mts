import type { ApiHandler } from '@server/api-router.mjs';
import businessPassportSign from '@server/passport/business-sign.mjs';
import baseSign from '@server/sites/base/api/sign.mjs';

const handler: ApiHandler = (c, next) => c.get('site').siteKey === 'passport'
	? baseSign(c, next, {})
	: businessPassportSign(c, next, {});

export default handler;
