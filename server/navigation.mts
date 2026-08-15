export const menuItems = [
	{ label: '首页', key: '/', icon: 'mail' },
	{ label: '阿里云', key: '/aliyun', icon: 'appstore' },
	{ label: '管理后台', key: '/panel', icon: 'appstore' },
	{ label: '关于', key: '/about', icon: 'appstore' },
	{ label: '登录', key: '/sign', icon: 'appstore' },
];

export const getManagementMenu = () => [
	{ label: '首页', key: '/panel', icon: 'mail' },
	{ label: '表列管理', key: '/panel/data/columns', icon: 'appstore' },
	{ label: '数据管理', key: '/panel/data/rows', icon: 'appstore' },
];

export const getPageDefinitions = () => [
	{ path: '/', component: 'home', title: '首页' },
	{ path: '/aliyun', component: 'aliyun', title: '阿里云管理' },
	{ path: '/aliyun/DescribeInstances', component: 'aliyunDescribeInstances', title: '阿里云管理' },
	{ path: '/panel', component: 'dashboard', title: '管理后台' },
	{ path: '/panel/data/columns', component: 'table', title: '表列管理' },
	{ path: '/panel/data/rows', component: 'table', title: '数据管理' },
	{ path: '/about', component: 'about', title: '关于' },
	{ path: '/sign', component: 'sign', title: '登录' },
];

export const getPageMetadata = (pathname: string) => {
	if (pathname === '/') {
		return { title: '首页', description: 'Quick React 项目首页' };
	}
	if (pathname.startsWith('/aliyun')) {
		return { title: '阿里云管理', description: '阿里云资源管理控制台' };
	}
	if (pathname.startsWith('/panel')) {
		return { title: '管理后台', description: 'Quick React 管理后台' };
	}
	if (pathname === '/about') {
		return { title: '关于', description: '关于 Quick React 项目' };
	}
	if (pathname === '/sign') {
		return { title: '登录', description: '登录 Quick React' };
	}
	return { title: 'Quick React', description: 'Quick React 应用' };
};
