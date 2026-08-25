import type { NavigationItem } from '@shared/types/navigation.mjs';
import { resolveNavigationPaths } from '@shared/navigation-tree.mjs';
export type MenuNode = NavigationItem;

const rawSiteNavigation = (): MenuNode[] => [
	{ label: '首页', key: '/', icon: 'mail', component: 'home', title: '首页', description: 'Quick React 项目首页' },
	{
		label: '管理后台',
		key: 'panel/admin',
		icon: 'appstore',
		component: 'panel',
		managementRoot: true,
		navigationGroup: 'management',
		dropdown: false,
		title: '管理后台',
		description: 'Quick React 管理后台',
		roles: ['admin'],
		children: [
			{ label: '首页', key: 'dashboard', icon: 'mail', component: 'dashboard', title: '首页', description: 'Quick React 管理后台概览' },
			{
				label: '系统管理',
				key: 'system',
				icon: 'appstore',
				children: [
					{ label: '系统设置', key: 'settings', icon: 'appstore', children: [
						{ label: '技术栈伪装', key: 'tech-stack', icon: 'appstore', component: 'form', title: '技术栈伪装', description: '配置 HTTP 技术栈响应头伪装' },
						{ label: '系统配置', key: 'system-config', icon: 'appstore', component: 'form', title: '系统配置', description: '配置 Quick React 服务运行参数' },
					] },
					{ label: '用户管理', key: 'users', icon: 'appstore', component: 'table', title: '用户管理', description: '管理系统用户、角色和状态' },
				],
			},
			{
				label: '数据管理',
				key: 'data',
				icon: 'appstore',
				children: [
					{ label: '表列管理', key: 'columns', icon: 'appstore', component: 'table', title: '表列管理', description: 'Quick React 管理后台' },
					{ label: '数据管理', key: 'rows', icon: 'appstore', component: 'table', title: '数据管理', description: 'Quick React 管理后台' },
				],
			},
		],
	},
	{ label: '关于', key: 'about', icon: 'appstore', component: 'about', title: '关于', description: '关于 Quick React 项目' },
	{
		label: '个人中心', key: 'panel/me', icon: 'appstore', hidden: true, component: 'personalCenter', navigationGroup: 'me', dashboardPath: '/panel/me/overview', title: '个人中心', description: '管理当前登录用户的账户信息', roles: ['user'],
		children: [
			{ label: '账户概览', key: 'overview', icon: 'appstore', component: 'personalCenter', title: '账户概览', description: '查看当前账户基本信息' },
			{ label: '个人资料', key: 'profile', icon: 'appstore', component: 'personalCenter', title: '个人资料', description: '查看和管理个人资料' },
			{ label: '安全设置', key: 'security', icon: 'appstore', component: 'personalCenter', title: '安全设置', description: '管理账户密码和安全设置' },
			{ label: '登录设备', key: 'sessions', icon: 'appstore', component: 'personalCenter', title: '登录设备', description: '查看账户登录设备和会话' },
		],
	},
];

export const menuItems = resolveNavigationPaths(rawSiteNavigation());

export default menuItems;
