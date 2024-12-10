import type React from 'react';
import type { MenuProps } from 'antd';
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Route, Routes } from 'react-router-dom';
import { AppstoreOutlined, MailOutlined } from '@ant-design/icons';

//import Table from './table';
import DescribeInstances from './DescribeInstances';
import { Layout, Menu } from 'antd';
const { Sider, Content } = Layout;

const App1 = () => {
	const navigate = useNavigate();
	function handleClick() {
		navigate('/aliyun/DescribeInstances');
	}
	return (
		<>
			<h1>Hello, React with esbuild!</h1>
			<button onClick={handleClick}>DescribeInstances</button>
		</>
	);
};
// 定义菜单项
type MenuItem = Required<MenuProps>['items'][number];

const items: MenuItem[] = [
	{
		label: '首页',
		key: '/aliyun',
		icon: <MailOutlined />,
	},
	{
		label: 'ECS实例',
		key: '/aliyun/DescribeInstances',
		icon: <AppstoreOutlined />,
	},
];

function AppRouter() {
	const location = useLocation(); // 获取当前 URL 路径
	const [current, setCurrent] = useState(location.pathname); // 同步选中状态
	const navigate = useNavigate();

	useEffect(() => {
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
			<Sider>
				<Menu
					onClick={onClick}
					selectedKeys={[current]}
					mode="inline"
					items={items}
				/>
			</Sider>
			<Content style={{ padding: 10, margin: 0, height: '100%' }}>
				<Routes>
					<Route path="/" element={<App1 />} />
					<Route path="/DescribeInstances" element={<DescribeInstances />} />
				</Routes>
			</Content>
		</Layout>
	);
}

export default AppRouter;
