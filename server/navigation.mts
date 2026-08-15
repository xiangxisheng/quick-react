type MenuNode = {
	label: string;
	key: string;
	icon: string;
	dropdown?: boolean;
	children?: MenuNode[];
	[key: string]: unknown;
};

const rawSiteNavigation = (): MenuNode[] => [
	{ label: '首页', key: '/', icon: 'mail', component: 'home', title: '首页', description: 'Quick React 项目首页' },
	{
		label: '阿里云', key: '/aliyun', icon: 'appstore', navigationGroup: 'aliyun', dropdown: false, component: 'panel', title: '阿里云管理', description: '阿里云资源管理控制台',
		children: [
			{ label: '首页', key: 'dashboard', icon: 'mail', component: 'dashboard', title: '首页', description: '阿里云管理概览' },
			{ label: '实例详情', key: 'DescribeInstances', icon: 'appstore', component: 'aliyunDescribeInstances', title: '实例详情', description: '阿里云 ECS 实例详情' },
		],
	},
	{
		label: '管理后台',
		key: '/panel/admin',
		icon: 'appstore',
		component: 'panel',
		managementRoot: true,
		navigationGroup: 'management',
		dropdown: false,
		title: '管理后台',
		description: 'Quick React 管理后台',
		children: [
			{ label: '首页', key: 'dashboard', icon: 'mail', component: 'dashboard', title: '首页', description: 'Quick React 管理后台概览' },
			{
				label: '系统设置',
				key: 'settings',
				icon: 'appstore',
				children: [
					{ label: '技术栈伪装', key: 'tech-stack', icon: 'appstore', component: 'form', title: '技术栈伪装', description: '配置 HTTP 技术栈响应头伪装' },
					{ label: '系统配置', key: 'system-config', icon: 'appstore', component: 'form', title: '系统配置', description: '配置 Quick React 服务运行参数' },
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
	{ label: '关于', key: '/about', icon: 'appstore', component: 'about', title: '关于', description: '关于 Quick React 项目' },
	{ label: '登录', key: '/sign', icon: 'appstore', component: 'sign', title: '登录', description: '登录 Quick React' },
];

const resolveMenuPaths = (items: MenuNode[], parentPath = ''): MenuNode[] => items.map((item) => {
	const key = String(item.key ?? '');
	const path = key.startsWith('/') ? key : `${parentPath}/${key}`.replaceAll('//', '/');
	const children = item.children ? resolveMenuPaths(item.children, path) : undefined;
	return { ...item, key: path, children };
});

export const menuItems = resolveMenuPaths(rawSiteNavigation());

export type PageDefinition = {
	path: string;
	component: string;
	title: string;
	description: string;
	navigation?: MenuNode[];
	dashboardPath?: string;
};

const collectPages = (items: MenuNode[], navigation: MenuNode[] = items, dashboardPath?: string): PageDefinition[] => items.flatMap((item) => {
	const pageNavigation = item.navigationGroup ? item.children ?? [] : navigation;
	const pageDashboardPath = item.component === 'panel'
		? item.children?.find((child) => child.component === 'dashboard')?.key
		: dashboardPath;
	const pages = typeof item.component === 'string' && typeof item.title === 'string'
		? [{ path: item.key, component: item.component, title: item.title, description: String(item.description ?? ''), navigation: pageNavigation, dashboardPath: pageDashboardPath }]
		: [];
	const children = item.children ? collectPages(item.children, pageNavigation, pageDashboardPath) : [];
	return [...pages, ...children];
});

export const getPageDefinitions = () => {
	const pages = collectPages(menuItems);
	return [...new Map(pages.map((page) => [page.path, page])).values()];
};

export const getPageMetadata = (pathname: string, pageSuffix = '.html') => {
	pathname = pageSuffix && pathname.endsWith(pageSuffix) ? pathname.slice(0, -pageSuffix.length) : pathname;
	const page = getPageDefinitions().find((item) => item.path === pathname);
	return page
		? { title: page.title, description: page.description }
		: { title: 'Quick React', description: 'Quick React 应用' };
};
