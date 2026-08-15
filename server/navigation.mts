export const menuItems = [
	{ label: '首页', key: '/', icon: 'mail', component: 'home', title: '首页', description: 'Quick React 项目首页' },
	{ label: '阿里云', key: '/aliyun', icon: 'appstore', component: 'aliyun', title: '阿里云管理', description: '阿里云资源管理控制台' },
	{ label: '阿里云实例详情', key: '/aliyun/DescribeInstances', icon: 'appstore', hidden: true, component: 'aliyunDescribeInstances', title: '阿里云管理', description: '阿里云资源管理控制台' },
	{ label: '管理后台', key: '/panel', icon: 'appstore', component: 'dashboard', title: '管理后台', description: 'Quick React 管理后台' },
	{ label: '关于', key: '/about', icon: 'appstore', component: 'about', title: '关于', description: '关于 Quick React 项目' },
	{ label: '登录', key: '/sign', icon: 'appstore', component: 'sign', title: '登录', description: '登录 Quick React' },
];

export const getManagementMenu = () => [
	{ label: '首页', key: '/panel', icon: 'mail', component: 'dashboard', title: '管理后台', description: 'Quick React 管理后台' },
	{
		label: '技术栈伪装',
		key: '/panel/tech-stack',
		icon: 'appstore',
		component: 'settings',
		title: '技术栈伪装',
		description: '配置 HTTP 技术栈响应头伪装',
	},
	{
		label: '数据管理',
		key: '/panel/data',
		icon: 'appstore',
		children: [
			{ label: '表列管理', key: '/panel/data/columns', icon: 'appstore', component: 'table', title: '表列管理', description: 'Quick React 管理后台' },
			{ label: '数据管理', key: '/panel/data/rows', icon: 'appstore', component: 'table', title: '数据管理', description: 'Quick React 管理后台' },
		],
	},
];

export type PageDefinition = {
	path: string;
	component: string;
	title: string;
	description: string;
};

const collectPages = (items: Array<Record<string, unknown>>): PageDefinition[] => items.flatMap((item) => {
	const pages = typeof item.component === 'string' && typeof item.title === 'string'
		? [{ path: String(item.key), component: item.component, title: item.title, description: String(item.description ?? '') }]
		: [];
	const children = Array.isArray(item.children) ? collectPages(item.children as Array<Record<string, unknown>>) : [];
	return [...pages, ...children];
});

export const getPageDefinitions = () => {
	const pages = [...collectPages(menuItems), ...collectPages(getManagementMenu())];
	return [...new Map(pages.map((page) => [page.path, page])).values()];
};

export const getPageMetadata = (pathname: string, pageSuffix = '.html') => {
	pathname = pageSuffix && pathname.endsWith(pageSuffix) ? pathname.slice(0, -pageSuffix.length) : pathname;
	const page = getPageDefinitions().find((item) => item.path === pathname);
	return page
		? { title: page.title, description: page.description }
		: { title: 'Quick React', description: 'Quick React 应用' };
};
