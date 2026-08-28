import type { ApiHandler } from '@server/api-router.mjs';
import { apiResponse } from '@server/api-response.mjs';
import { loadAvatarUrl } from '@server/passport/avatar.mjs';

/** 账户中心读取头像的临时访问地址；没有配置对象存储或还没有头像时返回空。 */
const handler: ApiHandler = async (c, next) => {
	if (c.req.method !== 'GET') return next();
	const url = await loadAvatarUrl(c.get('globalDatabase'), c.get('site').siteKey, String(c.get('passportUser')!.id))
		.catch(() => '');
	return apiResponse(c, 200, { avatarUrl: url });
};

export default handler;
