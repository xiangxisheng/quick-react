import type { MenuNode } from '@server/routes/base/navigation.mjs';

const navigation: MenuNode[] = [{
	// 首页说明应用用途：外部身份源验证时会检查首页是否公开说明用途。
	label: '首页', key: '/', icon: 'mail', component: 'home', title: '首页',
	description: '统一账号服务：使用微信、Google 或 Telegram 完成身份认证并绑定邮箱，用同一个账号登录接入本服务的业务站点。',
}, {
	// 账户中心只对持有 Accounts 会话的访问者可见，权限由 accounts 角色控制。
	label: '账户中心', key: 'panel/accounts', icon: 'appstore', navigationGroup: 'accounts', dropdown: false,
	component: 'panel', title: '账户中心', description: '管理 Accounts 账号的资料、邮箱和密码', roles: ['accounts'],
	children: [
		{ label: '概览', key: 'overview', icon: 'mail', component: 'dashboard', title: '账户概览', description: '查看 Accounts 账号的基本信息' },
		{ label: '个人资料', key: 'profile', icon: 'appstore', component: 'form', title: '个人资料', description: '修改 Accounts 昵称' },
		{ label: '邮箱管理', key: 'emails', icon: 'appstore', component: 'table', title: '邮箱管理', description: '查看邮箱、切换主邮箱和解绑邮箱' },
		{ label: '身份绑定', key: 'identities', icon: 'appstore', component: 'table', title: '身份绑定', description: '查看已绑定的第三方账号和 Telegram 账号并解绑' },
		{ label: '登录设备', key: 'devices', icon: 'appstore', component: 'table', title: '登录设备', description: '查看和注销使用 Accounts 登录的设备' },
		{ label: '安全设置', key: 'security', icon: 'appstore', component: 'form', title: '安全设置', description: '设置或修改 Accounts 密码' },
	],
}, {
	label: '管理后台', key: 'panel/admin', icon: 'appstore', children: [{
			label: 'Passport', key: 'passport', icon: 'appstore', children: [{
			label: '用户管理', key: 'users', icon: 'appstore', component: 'table', title: 'Accounts 用户', description: '查看 Passport 中的用户和账号状态' }, {
			label: '设备管理', key: 'devices', icon: 'appstore', component: 'table', title: '登录设备', description: '查看并注销 Accounts 登录设备' }, {
			label: '外部身份源', key: 'external-providers', icon: 'appstore', component: 'table', title: '外部身份源', description: '配置 Google 和微信作为 Accounts 的上游登录方式；Telegram 使用全局机器人配置' }, {
			label: 'OIDC', key: 'oidc', icon: 'appstore', children: [
				{ label: '客户端管理', key: 'clients', icon: 'appstore', component: 'table', title: 'OIDC 客户端', description: '管理接入 Accounts 的业务站点与应用' },
			],
		}],
}]}];

export default navigation;
