import type React from 'react';
import type { MenuProps } from 'antd';
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Route, Routes } from 'react-router-dom';
import {
	AppstoreOutlined,
	MailOutlined,
	MenuFoldOutlined,
	MenuUnfoldOutlined,
} from '@ant-design/icons';
import { Breadcrumb, Layout, Menu, theme } from 'antd';
import { Button } from 'antd';
const { Header, Content, Footer, Sider } = Layout;
import DescribeInstances from './DescribeInstances';

const App1 = () => {
	const navigate = useNavigate();
	function handleClick() {
		navigate('/aliyun/DescribeInstances');
	}
	return (
		<>
			<h1>Hello, React with esbuild!</h1>
			<Button onClick={handleClick}>DescribeInstances</Button>
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

	const [collapsed, setCollapsed] = useState(false);
	const {
		token: { colorBgContainer, borderRadiusLG },
	} = theme.useToken();

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
			<Sider
				theme="dark"
				collapsible
				collapsed={collapsed}
				onCollapse={(value) => setCollapsed(value)}
			>
				<div className="demo-logo-vertical" />
				<Menu
					onClick={onClick}
					selectedKeys={[current]}
					mode="inline"
					theme="dark"
					inlineCollapsed={collapsed}
					inlineIndent={12}
					items={items}
				/>
			</Sider>
			<Layout>
				<Header style={{
					height: 0,
					padding: 0,
					background: colorBgContainer,
					overflow: 'hidden',
				}}>
					<Breadcrumb style={{ margin: '4px' }}>
						<Breadcrumb.Item>User</Breadcrumb.Item>
						<Breadcrumb.Item>Bill</Breadcrumb.Item>
					</Breadcrumb>
				</Header>
				<Content style={{
					margin: '2px',
					height: '100%',
					overflowY: 'scroll',
				}}>
					<Routes>
						<Route path="/" element={<App1 />} />
						<Route path="/DescribeInstances" element={<DescribeInstances />} />
					</Routes>
				</Content>
				<Footer style={{
					height: '30px',
					padding: '2px',
					textAlign: 'center',
					overflow: 'hidden',
				}}>
					Ant Design ©{new Date().getFullYear()} Created by Ant UED
				</Footer>
			</Layout>
		</Layout>
	);
}

export default AppRouter;
