import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiResponse } from '@server/modules/base/api-response.mjs';
import type { HomePageData } from '@shared/types/home.mjs';

/** 站点首页的默认说明；具体站点可以在自己的 api/home.mts 里覆盖。 */
const handler: ApiHandler = (c, next) => {
	if (c.req.method !== 'GET') return next();
	const site = c.get('site');
	const home: HomePageData = {
		title: site.name,
		summary: `${site.name}提供网站页面与接口服务。登录后可以在个人中心查看当前账号信息。`,
		sections: [
			{ key: 'account', title: '账号', body: '使用本站账号登录后即可访问需要登录的页面；具体可用功能取决于账号被分配的角色。' },
			{ key: 'contact', title: '联系我们', body: `如对本站有任何疑问，请联系 ${c.get('siteSettings').contactEmail || '站点管理员'}。` },
		],
		links: [
			{ key: 'privacy', label: '隐私权政策', url: '/page/privacy.html' },
			{ key: 'terms', label: '服务条款', url: '/page/terms.html' },
		],
	};
	return apiResponse(c, 200, { home });
};

export default handler;
