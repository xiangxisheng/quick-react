import type { MenuNode } from '@server/sites/base/navigation.mjs';

const navigation: MenuNode[] = [{
	label: '管理后台', key: 'panel/admin', icon: 'appstore', children: [{
		label: '账号中心', key: 'accounts', icon: 'appstore', children: [{
			label: '外部身份源', key: 'external-providers', icon: 'appstore', component: 'table', title: '外部身份源', description: '配置 Google 和微信作为 Accounts 的上游登录方式；Telegram 使用全局机器人配置' }, {
			label: 'OIDC', key: 'oidc', icon: 'appstore', children: [
				{ label: '客户端管理', key: 'clients', icon: 'appstore', component: 'table', title: 'OIDC 客户端', description: '管理接入 Accounts 的业务站点与应用' },
			],
		}],
}]}];

export default navigation;
