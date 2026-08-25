import type React from 'react';
import type { MenuProps } from 'antd';
import type { CommonApi } from '@/utils/common/api.js';
import type { InitialData } from '@shared/types/initial-data.mjs';
import type { NavigationItem } from '@shared/types/navigation.mjs';
import { collectPageDefinitions, type NavigationPageDefinition } from '@shared/navigation-tree.mjs';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout, Menu, Space } from 'antd';
import { AppstoreOutlined, MailOutlined } from '@ant-design/icons';
import DescribeInstances from './components/aliyun/DescribeInstances.js';
import Panel from './components/panel/PanelLayout.js';
import Dashboard from './components/panel/Dashboard.js';
import TableCRUD from '@/utils/antd/table_crud/index.js';
import FormPage from './components/panel/FormPage.js';
import AuthActions from './components/AuthActions.js';
import PersonalCenter from './components/panel/PersonalCenter.js';
const { Content } = Layout;

// 定义路由对应的页面组件
const Home = () => <h1 style={{ padding: 10, margin: 0, height: '100%' }}>Home Page</h1>;
const About = () => <h1 style={{ padding: 10, margin: 0, height: '100%' }}>About Page</h1>;

type MenuItem = Required<MenuProps>['items'][number];

const serverData = (window as Window & { __INITIAL_DATA__?: InitialData }).__INITIAL_DATA__;
	const initialData = serverData ?? { apiSuffix: '', pageSuffix: '', siteNavigation: [] };
const siteNavigation = initialData.siteNavigation;
const pageUrl = (path: string) => path === '/' ? path : `${path}${initialData.pageSuffix}`;

type PageDefinition = NavigationPageDefinition;

const pages = collectPageDefinitions(siteNavigation);
const authPages: PageDefinition[] = (initialData.auth?.pages ?? []).map((page) => ({
	path: page.path,
	component: 'sign',
	title: page.title,
	description: page.description ?? '',
	navigation: [],
	mode: page.mode,
	apiPath: page.apiPath,
	submitMethod: page.submitMethod,
	redirectPath: page.redirectPath,
}));
const iconComponents = {
	mail: <MailOutlined />,
	appstore: <AppstoreOutlined />,
};
const toMenuItems = (menu: NavigationItem[], onTitleClick?: (key: string) => void): MenuItem[] => menu.filter((item) => !item.hidden).map((item) => ({
	label: item.label,
	key: item.key,
	icon: iconComponents[item.icon as keyof typeof iconComponents],
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
		personalCenter: (page) => <Panel commonApi={commonApi} navigation={page.navigation} dashboardPath={page.dashboardPath} title={page.title}><PersonalCenter user={initialData.auth?.currentUser} title={page.title} path={page.path} /></Panel>,
		sign: (page) => {
			return <FormPage
				commonApi={commonApi}
				apiPath={`${page.apiPath}?mode=${page.mode}`}
				title={page.title}
				submitMethod={page.submitMethod}
				redirectOnFeedback
				onSaved={() => page.redirectPath}
			/>;
		},
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
	const routes = [...pages, ...authPages].flatMap((page) => {
		const render = pageRenderers[page.component];
		if (!render) return [];
		const routePath = page.component === 'sign' ? page.path : pageUrl(page.path);
		return [{ path: routePath, element: render(page) }];
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
			<Layout.Header style={{ height: 48, minHeight: 48, lineHeight: '48px', padding: '0 24px', display: 'flex', alignItems: 'center', background: '#fff', borderBottom: '1px solid #f0f0f0' }}>
				<Menu
					onClick={onClick}
					selectedKeys={[current]}
					mode="horizontal"
					items={items}
					style={{ flex: 1, minWidth: 0, borderBottom: 0 }}
				/>
				<Space size={4}><AuthActions auth={initialData.auth} commonApi={commonApi} apiSuffix={initialData.apiSuffix} pageSuffix={initialData.pageSuffix} /></Space>
			</Layout.Header>
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
