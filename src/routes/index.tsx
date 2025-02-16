import type React from 'react';
import type { MenuProps } from 'antd';
import type { CommonApi } from '@/utils/common/api';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import { AppstoreOutlined, MailOutlined } from '@ant-design/icons';
import AliyunIndex from './aliyun/index';
import Sign from './sign';
import Panel from './panel';
const { Content } = Layout;

interface RouteConfig {
	path: string;
	element: React.ReactNode;
}

// 定义路由对应的页面组件
const Home = () => <h1 style={{ padding: 10, margin: 0, height: '100%' }}>Home Page</h1>;
const About = () => <h1 style={{ padding: 10, margin: 0, height: '100%' }}>About Page</h1>;

type MenuItem = Required<MenuProps>['items'][number];

// 定义菜单项
const items: MenuItem[] = [
	{
		label: '首页',
		key: '/',
		icon: <MailOutlined />,
	},
	{
		label: '阿里云',
		key: '/aliyun',
		icon: <AppstoreOutlined />,
	},
	{
		label: '管理后台',
		key: '/panel',
		icon: <AppstoreOutlined />,
	},
	{
		label: '关于',
		key: '/about',
		icon: <AppstoreOutlined />,
	},
	{
		label: '登录',
		key: '/sign',
		icon: <AppstoreOutlined />,
	},
];


type AppType = {
	commonApi: CommonApi;
};

const App = ({ commonApi }: AppType) => {

	const routes: RouteConfig[] = [
		{ path: '/', element: <Home /> },
		{ path: '/aliyun/*', element: <AliyunIndex /> },
		{ path: '/panel/*', element: <Panel commonApi={commonApi} /> },
		{ path: '/about', element: <About /> },
		{ path: '/sign', element: <Sign /> },
	];

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
	}, [location.pathname]);

	const onClick: MenuProps['onClick'] = (e) => {
		console.log('click ', e);
		setCurrent(e.key);

		// 对非外部链接的菜单项手动导航
		if (!e.keyPath.some((key) => key === 'external')) {
			navigate(e.key); // 使用 e.key 作为路径
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
					{memoizedRoutes.map((route, index) => (
						<Route key={index} path={route.path} element={route.element} />
					))}
				</Routes>
			</Content>
		</Layout>
	);
};

// 使用 Router 包裹应用
import type { Config } from '@/config';
type RouteIndexType = {
	config: Config;
};

import { useCommonApi } from '@/utils/common/api'

const RouteIndex = ({ config }: RouteIndexType) => {
	const [commonApi, contextHolder] = useCommonApi();
	console.log(config)
	return (
		<Router>
			{contextHolder}
			<App commonApi={commonApi} />
		</Router>
	);
};

export default RouteIndex;
