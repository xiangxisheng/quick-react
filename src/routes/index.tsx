import type React from 'react';
import type { MenuProps } from 'antd';
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import { AppstoreOutlined, MailOutlined } from '@ant-design/icons';
import AliyunIndex from './aliyun/index';
const { Content } = Layout;

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
		label: '关于',
		key: '/about',
		icon: <AppstoreOutlined />,
	},
];

const App: React.FC = () => {
	const location = useLocation(); // 获取当前 URL 路径
	const [current, setCurrent] = useState(location.pathname); // 同步选中状态
	const navigate = useNavigate();

	useEffect(() => {
		// 设置 body 的 margin 为 0
		document.body.style.margin = '0';
		document.body.style.height = '100%';
		document.documentElement.style.height = '100%';
		setCurrent(location.pathname); // URL 变化时同步菜单高亮
	}, [location.pathname]);

	const onClick: MenuProps['onClick'] = (e) => {
		console.log('click ', e);
		setCurrent(e.key);

		// 对非外部链接的菜单项手动导航
		if (!e.keyPath.some((key) => key === 'external')) {
			navigate(e.key); // 使用 e.key 作为路径
		}
	};

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
					<Route path="/" element={<Home />} />
					<Route path="/aliyun/*" element={<AliyunIndex />} />
					<Route path="/about" element={<About />} />
				</Routes>
			</Content>
		</Layout>
	);
};

// 使用 Router 包裹应用
const RootApp = () => (
	<Router>
		<App />
	</Router>
);

export default RootApp;
