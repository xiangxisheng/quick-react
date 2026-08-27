import type { ApiHandler } from '@server/api-router.mjs';
import { apiResponse } from '@server/api-response.mjs';
import type { HomePageData } from '@shared/types/home.mjs';

/**
 * Accounts 账号中心首页。
 * 外部身份源（Google 等）在应用验证时要求首页公开说明应用的用途、功能范围和数据使用方式。
 */
const handler: ApiHandler = (c, next) => {
	if (c.req.method !== 'GET') return next();
	const site = c.get('site');
	const home: HomePageData = {
		title: site.name,
		summary: '本站是统一账号服务：你可以使用微信、Google 或 Telegram 完成身份认证，绑定并验证邮箱，设置用户名和密码，然后用同一个账号登录接入本服务的业务站点，无需在每个站点重复注册。',
		sections: [
			{ key: 'sign-in', title: '登录方式', body: '支持微信扫码登录、Google 账号登录、Telegram 消息批准登录；设置密码后也可以直接使用邮箱和密码登录。首次创建账号需要先完成一次第三方身份认证，并验证一个邮箱。' },
			{ key: 'account', title: '账号管理', body: '登录后可以在账户中心修改昵称、添加并验证邮箱、切换主邮箱、解绑不再使用的邮箱，以及设置或修改登录密码。用户名在首次设置后不可更改。' },
			{ key: 'sso', title: '为业务站点提供统一登录', body: '业务站点通过标准 OpenID Connect 协议接入。你在业务站点点击登录后，会在弹出的窗口中完成认证；授权成功后，该站点只获得你的账号编号、用户名、昵称和主邮箱，用于在该站点识别你的身份。' },
			{ key: 'privacy', title: '数据与隐私', body: '我们只收集完成账号功能所必需的信息（账号标识、邮箱、密码哈希、第三方身份标识、会话与登录来源），不会用于广告投放，也不会出售给第三方。通过 Google 账号登录获取的信息仅用于创建和识别本站账号，遵守 Google API 服务用户数据政策，包括其中的有限使用要求。' },
			{ key: 'contact', title: '联系我们', body: '如需注销账号、行使查询与删除权利，或对本服务有任何疑问，请联系 xiangxisheng@gmail.com。' },
		],
		links: [
			{ key: 'sign-in', label: '登录 / 创建账号', url: `/accounts/sign${c.get('techStackConfig').pageSuffix}` },
			{ key: 'privacy', label: '隐私权政策', url: '/page/privacy.html' },
			{ key: 'terms', label: '服务条款', url: '/page/terms.html' },
		],
	};
	return apiResponse(c, 200, { home });
};

export default handler;
