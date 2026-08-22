import type { MenuNode } from '@server/sites/base/navigation.mjs';

const navigation: MenuNode[] = [{
	label: '阿里云', key: 'aliyun', icon: 'appstore', navigationGroup: 'aliyun', dropdown: false, component: 'panel', title: '阿里云管理', description: '阿里云资源管理控制台',
	children: [
		{ label: '首页', key: 'dashboard', icon: 'mail', component: 'dashboard', title: '首页', description: '阿里云管理概览' },
		{ label: '实例详情', key: 'DescribeInstances', icon: 'appstore', component: 'aliyunDescribeInstances', title: '实例详情', description: '阿里云 ECS 实例详情' },
	],
}];

export default navigation;
