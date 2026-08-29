import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiResponse } from '@server/modules/base/api-response.mjs';
import { loadAccountProfile, utcMinutes } from '@server/passport/account.mjs';
import { loadAvatarUrl } from '@server/passport/avatar.mjs';
import type { DashboardData } from '@shared/types/dashboard.mjs';

const handler: ApiHandler = async (c, next) => {
	if (c.req.method !== 'GET') return next();
	const userId = String(c.get('passportUser')!.id);
	const [profile, avatarUrl] = await Promise.all([
		loadAccountProfile(c.get('passportDatabase')!, userId),
		loadAvatarUrl(c.get('globalDatabase'), c.get('site').siteKey, userId).catch(() => ''),
	]);
	const dashboard: DashboardData = {
		recentTitle: '账户信息',
		statistics: [
			{ key: 'emails', label: '已绑定邮箱', value: profile.emails.length },
			{ key: 'providers', label: '第三方身份', value: profile.providers.length },
			{ key: 'telegram', label: 'Telegram 账号', value: profile.telegramCount },
		],
		recentColumns: [
			{ dataIndex: 'item', title: '项目' },
			{ dataIndex: 'value', title: '内容' },
		],
		recentRows: [
			{ key: 'username', item: '用户名', value: profile.username ?? '未设置' },
			{ key: 'nickname', item: '昵称', value: profile.nickname },
			{ key: 'email', item: '主邮箱', value: profile.primaryEmail || '未设置' },
			{ key: 'password', item: '密码', value: profile.hasPassword ? '已设置' : '未设置' },
			{ key: 'avatar', item: '头像', value: avatarUrl ? '已同步到对象存储' : '未同步' },
			{ key: 'created_at', item: '注册时间', value: profile.createdAt ? utcMinutes(profile.createdAt) : '未知' },
		],
	};
	return apiResponse(c, 200, { dashboard });
};

export default handler;
