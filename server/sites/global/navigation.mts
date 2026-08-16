import type { MenuNode } from '@server/sites/base/navigation.mjs';

const navigation: MenuNode[] = [{
	label: '管理后台',
	key: '/panel/admin',
	icon: 'appstore',
	children: [
		{ label: '站点管理', key: '/panel/admin/sites', icon: 'appstore', component: 'table', title: '站点管理', description: '管理代码站点、继承关系和数据库目标' },
		{ label: 'Host 管理', key: '/panel/admin/hosts', icon: 'appstore', component: 'table', title: 'Host 管理', description: '管理域名与站点绑定' },
	],
}];

export default navigation;
