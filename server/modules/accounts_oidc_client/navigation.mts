import type { MenuNode } from '@server/sites/base/navigation.mjs';

const navigation: MenuNode[] = [{
	label: '管理后台', key: 'panel/admin', icon: 'appstore', children: [{
		label: '系统管理', key: 'system', icon: 'appstore', children: [{
			label: '系统设置', key: 'settings', icon: 'appstore', children: [
				{ label: 'Accounts 登录', key: 'accounts-oidc', icon: 'appstore', component: 'form', title: 'Accounts OIDC 登录', description: '通过标准 OIDC 接入独立部署的 Accounts 账号中心' },
			],
		}],
}]}];
export default navigation;
