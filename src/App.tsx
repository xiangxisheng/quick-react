import type React from 'react';
import type { MenuProps } from 'antd';
import type { CommonApi } from '@/utils/common/api.js';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import { AppstoreOutlined, MailOutlined } from '@ant-design/icons';
import DescribeInstances from './components/aliyun/DescribeInstances.js';
import Sign from './components/Sign.js';
import Panel from './components/panel/PanelLayout.js';
import Dashboard from './components/panel/Dashboard.js';
import TableCRUD from '@/utils/antd/table_crud/index.js';
import FormPage from './components/panel/Form.js';
const { Content } = Layout;

// 定义路由对应的页面组件
const Home = () => <h1 style={{ padding: 10, margin: 0, height: '100%' }}>Home Page</h1>;
const About = () => <h1 style={{ padding: 10, margin: 0, height: '100%' }}>About Page</h1>;

type MenuItem = Required<MenuProps>['items'][number];

interface InitialMenuItem {
	label: string;
	key: string;
	icon: 'mail' | 'appstore';
	dropdown?: boolean;
	hidden?: boolean;
	component?: string;
	title?: string;
	description?: string;
	navigationGroup?: string;
	navigation?: InitialMenuItem[];
	dashboardPath?: string;
	children?: InitialMenuItem[];
}

interface InitialData {
	apiSuffix: string;
	pageSuffix: string;
	siteNavigation: InitialMenuItem[];
}

const serverData = (window as Window & { __INITIAL_DATA__?: InitialData }).__INITIAL_DATA__;
	const initialData = serverData ?? { apiSuffix: '', pageSuffix: '', siteNavigation: [] };
const siteNavigation = initialData.siteNavigation;
const pageUrl = (path: string) => path === '/' ? path : `${path}${initialData.pageSuffix}`;

type PageDefinition = InitialMenuItem & { path: string; component: string; title: string; navigation: InitialMenuItem[]; dashboardPath?: string };

const collectPages = (items: InitialMenuItem[], navigation: InitialMenuItem[] = items, dashboardPath?: string): PageDefinition[] => items.flatMap((item) => {
	const pageNavigation = item.component === 'panel' ? item.children ?? [] : navigation;
	const pageDashboardPath = item.component === 'panel'
		? item.children?.find((child) => child.component === 'dashboard')?.key
		: dashboardPath;
	const page = item.component && item.title
		? [{ ...item, path: item.key, component: item.component, title: item.title, navigation: pageNavigation, dashboardPath: pageDashboardPath }]
		: [];
	const children = item.children ? collectPages(item.children, pageNavigation, pageDashboardPath) : [];
	return [...page, ...children];
});

const pages = collectPages(siteNavigation);
const iconComponents = {
	mail: <MailOutlined />,
	appstore: <AppstoreOutlined />,
};
const toMenuItems = (menu: InitialMenuItem[], onTitleClick?: (key: string) => void): MenuItem[] => menu.filter((item) => !item.hidden).map((item) => ({
	label: item.label,
	key: item.key,
	icon: iconComponents[item.icon],
	children: item.children && item.dropdown !== false ? toMenuItems(item.children, onTitleClick) : undefined,
	...(item.children && onTitleClick ? { onTitleClick: () => onTitleClick(item.key) } : {}),
}));


type AppType = {
	commonApi: CommonApi;
};

const App = ({ commonApi }: AppType) => {
	const pageRenderers: Record<string, (page: PageDefinition) => React.ReactNode> = {
		home: () => <Home />,
		about: () => <About />,
		sign: () => <Sign commonApi={commonApi} />,
		panel: (page) => <Panel commonApi={commonApi} navigation={page.navigation} dashboardPath={page.dashboardPath} title={page.title}><Dashboard commonApi={commonApi} apiPath={`/api${page.dashboardPath ?? ''}${initialData.apiSuffix}`} /></Panel>,
		dashboard: (page) => <Panel commonApi={commonApi} navigation={page.navigation} dashboardPath={page.dashboardPath} title={page.title}><Dashboard commonApi={commonApi} apiPath={`/api${page.dashboardPath ?? ''}${initialData.apiSuffix}`} /></Panel>,
		table: (page) => <Panel commonApi={commonApi} navigation={page.navigation} dashboardPath={page.dashboardPath} title={page.title}><TableCRUD commonApi={commonApi} resourcePath={page.path} /></Panel>,
		form: (page) => <Panel commonApi={commonApi} navigation={page.navigation} dashboardPath={page.dashboardPath} title={page.title}><FormPage
			commonApi={commonApi}
			apiPath={`/api${page.path}${initialData.apiSuffix}`}
			 title={page.title}
			onSaved={(values) => {
				const pageSuffix = typeof values.pageSuffix === 'string' ? values.pageSuffix : initialData.pageSuffix;
				return `${page.path}${pageSuffix}`;
			}}
		/></Panel>,
		aliyunDescribeInstances: (page) => <Panel commonApi={commonApi} navigation={page.navigation} dashboardPath={page.dashboardPath} title={page.title}><DescribeInstances /></Panel>,
	};
	const routes = pages.flatMap((page) => {
		const render = pageRenderers[page.component];
		if (!render) return [];
		return [{ path: pageUrl(page.path), element: render(page) }];
	});

	const location = useLocation(); // 获取当前 URL 路径
	const [current, setCurrent] = useState(location.pathname); // 同步选中状态
	const navigate = useNavigate();
	const items: MenuItem[] = toMenuItems(siteNavigation, (key) => navigate(pageUrl(key)));

	useEffect(() => {
		// 设置 body 的 margin 为 0
		document.body.style.margin = '0';
		document.body.style.height = '100%';
		document.documentElement.style.height = '100%';
		const a = location.pathname.split('/');
		for (const item of items) {
			if ((location.pathname + '/').indexOf((item?.key ?? '').toString() + '/') === 0) {
				// URL 变化时同步菜单高亮
				setCurrent((item?.key ?? '').toString());
				continue;
			}
		}
		const logicalPath = initialData.pageSuffix && location.pathname.endsWith(initialData.pageSuffix)
			? location.pathname.slice(0, -initialData.pageSuffix.length)
			: location.pathname;
		for (const item of items) {
			if (!item || typeof item.key !== 'string') continue;
			if ((logicalPath + '/').indexOf(`${item.key}/`) === 0) {
				setCurrent(item.key);
			}
		}
		const page = pages.find((item) => item.path === logicalPath);
		if (page) {
			document.title = `${page.title} | Quick React`;
		}
	}, [location.pathname]);

	const onClick: MenuProps['onClick'] = (e) => {
		console.log('click ', e);
		setCurrent(e.key);

		// 对非外部链接的菜单项手动导航
		if (!e.keyPath.some((key) => key === 'external')) {
			navigate(pageUrl(e.key));
		}
	};
	const memoizedRoutes = useMemo(() => routes, []);

	return (
		<Layout style={{ height: '100%' }}>
			<Menu
				onClick={onClick}
				selectedKeys={[current]}
				mode="horizontal"
				items={items}
			/>
			<Content>
				<Routes>
					{memoizedRoutes.map((route) => (
						<Route key={route.path} path={route.path} element={route.element} />
					))}
				</Routes>
			</Content>
		</Layout>
	);
};

import { useCommonApi } from '@/utils/common/api.js'

const AppRoot = () => {
	const [commonApi, contextHolder] = useCommonApi();
	return (
		<Router>
			{contextHolder}
			<App commonApi={commonApi} />
		</Router>
	);
};

export default AppRoot;
