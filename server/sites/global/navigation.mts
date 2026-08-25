import type { MenuNode } from '@server/sites/base/navigation.mjs';

const navigation: MenuNode[] = [{
	label: '管理后台',
	key: 'panel/admin',
	icon: 'appstore',
	children: [
		{
			label: '全局管理',
			key: 'global',
			icon: 'appstore',
			children: [
				{
					label: '站点管理',
					key: 'site',
					icon: 'appstore',
					children: [
						{ label: '站点列表', key: 'sites', icon: 'appstore', component: 'table', title: '站点管理', description: '管理代码站点、继承关系和数据库目标' },
						{ label: '域名绑定', key: 'hosts', icon: 'appstore', component: 'table', title: '站点域名', description: '管理站点域名与站点绑定' },
					],
				},
				{
					label: '云服务',
					key: 'cloud',
					icon: 'appstore',
					children: [
						{ label: '凭据管理', key: 'credentials', icon: 'appstore', component: 'table', title: '云凭据', description: '管理云服务访问身份' },
						{
							label: '对象存储',
							key: 'object-storage',
							icon: 'appstore',
							children: [
								{ label: 'Bucket 管理', key: 'buckets', icon: 'appstore', component: 'table', title: 'Bucket 管理', description: '发现、接入和测试对象存储 Bucket' },
								{ label: '站点绑定', key: 'bindings', icon: 'appstore', component: 'table', title: '对象存储站点绑定', description: '将 Bucket 按用途绑定到业务站点' },
								{ label: '对象管理', key: 'objects', icon: 'appstore', component: 'table', title: '对象管理', description: '浏览和管理已绑定 Bucket 中的对象' },
							],
						},
					],
				},
			],
		},
	],
}];

export default navigation;
