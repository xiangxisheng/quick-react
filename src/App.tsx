import type React from 'react';
import type { MenuProps } from 'antd';
import type { CommonApi } from '@/utils/common/api.js';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import { AppstoreOutlined, MailOutlined } from '@ant-design/icons';
import AliyunIndex from './components/aliyun/AliyunLayout.js';
import DescribeInstances from './components/aliyun/DescribeInstances.js';
import Sign from './components/Sign.js';
import Panel from './components/panel/PanelLayout.js';
import TableCRUD from '@/utils/antd/table_crud/index.js';
import SettingsForm from './components/panel/SettingsForm.js';
const { Content } = Layout;

// 定义路由对应的页面组件
const Home = () => <h1 style={{ padding: 10, margin: 0, height: '100%' }}>Home Page</h1>;
const About = () => <h1 style={{ padding: 10, margin: 0, height: '100%' }}>About Page</h1>;

type MenuItem = Required<MenuProps>['items'][number];

interface InitialMenuItem {
	label: string;
	key: string;
	icon: 'mail' | 'appstore';
	hidden?: boolean;
	component?: string;
	title?: string;
	children?: InitialMenuItem[];
}

interface InitialData {
	apiSuffix: string;
	pageSuffix: string;
	siteNavigation: InitialMenuItem[];
	managementMenu: InitialMenuItem[];
	pages: Array<{ path: string; component: string; title: string }>;
}

const fallbackData: InitialData = {
	apiSuffix: '',
	pageSuffix: '.html',
	siteNavigation: [
		{ label: '首页', key: '/', icon: 'mail', component: 'home', title: '首页' },
		{ label: '阿里云', key: '/aliyun', icon: 'appstore', component: 'aliyun', title: '阿里云管理' },
		{ label: '管理后台', key: '/panel/admin', icon: 'appstore', component: 'dashboard', title: '管理后台' },
		{ label: '关于', key: '/about', icon: 'appstore', component: 'about', title: '关于' },
		{ label: '登录', key: '/sign', icon: 'appstore', component: 'sign', title: '登录' },
	],
	managementMenu: [{ label: '首页', key: '/panel', icon: 'mail', component: 'dashboard', title: '管理后台' }],
	pages: [
		{ path: '/', component: 'home', title: '首页' },
		{ path: '/aliyun', component: 'aliyun', title: '阿里云管理' },
		{ path: '/aliyun/DescribeInstances', component: 'aliyunDescribeInstances', title: '阿里云管理' },
		{ path: '/panel/admin', component: 'dashboard', title: '管理后台' },
		{ path: '/about', component: 'about', title: '关于' },
		{ path: '/sign', component: 'sign', title: '登录' },
	],
};

const serverData = (window as Window & { __INITIAL_DATA__?: InitialData }).__INITIAL_DATA__;
const initialData = serverData ?? fallbackData;
const siteNavigation = initialData.siteNavigation;
const pageUrl = (path: string) => path === '/' ? path : `${path}${initialData.pageSuffix}`;
const iconComponents = {
	mail: <MailOutlined />,
	appstore: <AppstoreOutlined />,
};
const toMenuItems = (menu: InitialMenuItem[]): MenuItem[] => menu.filter((item) => !item.hidden).map((item) => ({
	label: item.label,
	key: item.key,
	icon: iconComponents[item.icon],
	children: item.children ? toMenuItems(item.children) : undefined,
}));
const items: MenuItem[] = toMenuItems(siteNavigation);


type AppType = {
	commonApi: CommonApi;
};

const App = ({ commonApi }: AppType) => {
	const componentRegistry: Record<string, React.ComponentType> = {
		home: Home,
		aliyun: AliyunIndex,
		aliyunDescribeInstances: () => <AliyunIndex><DescribeInstances /></AliyunIndex>,
		 dashboard: () => <Panel commonApi={commonApi} />,
		about: About,
		sign: Sign,
	};
	const routes = initialData.pages.flatMap((page) => {
		const Component = page.component === 'table' ? undefined : componentRegistry[page.component];
		if (!Component && page.component !== 'table' && page.component !== 'settings') return [];
		const element = page.component === 'table'
			? <Panel commonApi={commonApi}><TableCRUD commonApi={commonApi} resourcePath={page.path} /></Panel>
			: page.component === 'settings'
				? <Panel commonApi={commonApi}><SettingsForm
					commonApi={commonApi}
					apiPath={`/api${page.path}${initialData.apiSuffix}`}
					title={page.title}
					onSaved={(values) => {
						const pageSuffix = typeof values.pageSuffix === 'string' ? values.pageSuffix : initialData.pageSuffix;
						window.location.assign(`${page.path}${pageSuffix}`);
					}}
				/></Panel>
			: Component ? <Component /> : null;
		if (!element) return [];
		return [{ path: pageUrl(page.path), element }];
	});

	const location = useLocation(); // 获取当前 URL 路径
	const [current, setCurrent] = useState(location.pathname); // 同步选中状态
	const navigate = useNavigate();

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
		const page = initialData.pages.find((item) => item.path === logicalPath);
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
