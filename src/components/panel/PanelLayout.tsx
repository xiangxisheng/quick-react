import type React from 'react';
import type { MenuProps } from 'antd';
import type { CommonApi } from '@/utils/common/api.js';
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
	AppstoreOutlined,
	MailOutlined,
	MenuFoldOutlined,
	MenuUnfoldOutlined,
} from '@ant-design/icons';
import { Breadcrumb, Card, Col, Layout, Menu, Row, Statistic, Table, theme } from 'antd';
import { Button } from 'antd';
const { Header, Content, Footer, Sider } = Layout;

// 定义菜单项
type MenuItem = Required<MenuProps>['items'][number];

interface InitialMenuItem {
	label: string;
	key: string;
	icon: 'mail' | 'appstore';
	children?: InitialMenuItem[];
}

const initialData = (window as Window & {
	__INITIAL_DATA__?: { managementMenu: InitialMenuItem[] };
}).__INITIAL_DATA__;
const iconComponents = {
	mail: <MailOutlined />,
	appstore: <AppstoreOutlined />,
};
const toMenuItems = (menu: InitialMenuItem[]): MenuItem[] => menu.map((item) => ({
	label: item.label,
	key: item.key,
	icon: iconComponents[item.icon],
	children: item.children ? toMenuItems(item.children) : undefined,
}));
const managementMenu = initialData?.managementMenu ?? [];
const items: MenuItem[] = toMenuItems(managementMenu);

const findMenuItem = (menu: InitialMenuItem[], pathname: string): InitialMenuItem | undefined => {
	for (const item of menu) {
		if (item.key === pathname) return item;
		const child = item.children && findMenuItem(item.children, pathname);
		if (child) return child;
	}
	return undefined;
};

const findParentKeys = (menu: InitialMenuItem[], pathname: string, parents: string[] = []): string[] => {
	for (const item of menu) {
		if (item.key === pathname) return parents;
		if (item.children) {
			const result = findParentKeys(item.children, pathname, [...parents, item.key]);
			if (result.length) return result;
		}
	}
	return [];
};

type AppType = {
	commonApi: CommonApi;
	children?: React.ReactNode;
};

interface DashboardData {
	statistics: Array<{ key: string; label: string; value: number }>;
	recentRows: Array<{ key: string; name: string; status: string; createdAt: string }>;
}

function Dashboard({ commonApi }: { commonApi: CommonApi }) {
	const [data, setData] = useState<DashboardData>();
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let active = true;
		commonApi.apiFetch('/api/panel/dashboard')
			.then(async (response) => {
				const result = await response.json() as { dashboard?: DashboardData };
				if (active) {
					setData(result.dashboard);
				}
			})
			.catch((error) => console.error('加载 dashboard 数据失败', error))
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => { active = false; };
	}, [commonApi]);

	const columns = [
		{ title: '名称', dataIndex: 'name', key: 'name' },
		{ title: '状态', dataIndex: 'status', key: 'status' },
		{ title: '创建时间', dataIndex: 'createdAt', key: 'createdAt' },
	];

	return (
		<div>
			<h1>Dashboard</h1>
			<Row gutter={[16, 16]}>
				{data?.statistics.map((item) => (
					<Col xs={24} sm={8} key={item.key}>
						<Card loading={loading}><Statistic title={item.label} value={item.value} /></Card>
					</Col>
				))}
			</Row>
			<Card title="最近数据" style={{ marginTop: 16 }} loading={loading}>
				<Table rowKey="key" columns={columns} dataSource={data?.recentRows ?? []} pagination={false} />
			</Card>
		</div>
	);
}

function AppRouter({ commonApi, children }: AppType) {
	const location = useLocation(); // 获取当前 URL 路径
	const [current, setCurrent] = useState(location.pathname); // 同步选中状态
	const [openKeys, setOpenKeys] = useState<string[]>(() => findParentKeys(managementMenu, location.pathname));
	const navigate = useNavigate();

	const [collapsed, setCollapsed] = useState(false);
	const {
		token: { colorBgContainer, borderRadiusLG },
	} = theme.useToken();

	useEffect(() => {
		setCurrent(location.pathname); // URL 变化时同步菜单高亮
		setOpenKeys(findParentKeys(managementMenu, location.pathname));
	}, [location.pathname]);

	const currentMenuItem = findMenuItem(managementMenu, location.pathname);
	const breadcrumbItems = [
		{ title: '管理后台' },
		...(location.pathname === '/panel' || !currentMenuItem ? [] : [{ title: currentMenuItem.label }]),
	];

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
					openKeys={openKeys}
					onOpenChange={(keys) => setOpenKeys(keys as string[])}
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
					margin: '8px',
					height: '100%',
					overflowY: 'scroll',
				}}>
					<Breadcrumb items={breadcrumbItems} style={{ marginBottom: '8px' }} />
					{children ?? <Dashboard commonApi={commonApi} />}
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
