import type React from 'react';
import type { MenuProps } from 'antd';
import type { CommonApi } from '@/utils/common/api.js';
import type { NavigationItem } from '@shared/types/navigation.mjs';
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
	AppstoreOutlined,
	MailOutlined,
	MenuFoldOutlined,
	MenuUnfoldOutlined,
} from '@ant-design/icons';
import { Breadcrumb, Layout, Menu, theme } from 'antd';
const { Header, Content, Footer, Sider } = Layout;

// 定义菜单项
type MenuItem = Required<MenuProps>['items'][number];

type InitialMenuItem = NavigationItem;

const initialData = (window as Window & {
	__INITIAL_DATA__?: { apiSuffix?: string; footer?: string };
}).__INITIAL_DATA__;
const apiSuffix = initialData?.apiSuffix ?? '';
const pageSuffix = (window as Window & { __INITIAL_DATA__?: { pageSuffix?: string } }).__INITIAL_DATA__?.pageSuffix ?? '';
const iconComponents = {
	mail: <MailOutlined />,
	appstore: <AppstoreOutlined />,
};
const toMenuItems = (menu: InitialMenuItem[]): MenuItem[] => menu.map((item) => ({
	label: item.label,
	key: item.key,
	icon: iconComponents[item.icon as keyof typeof iconComponents],
	children: item.children ? toMenuItems(item.children) : undefined,
}));
const pageUrl = (path: string) => path === '/' ? path : `${path}${pageSuffix}`;

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
	navigation?: InitialMenuItem[];
	dashboardPath?: string;
	title?: string;
};

function AppRouter({ commonApi, children, navigation = [], dashboardPath, title }: AppType) {
	const items: MenuItem[] = toMenuItems(navigation);
	const dashboardApiPath = dashboardPath ? `/api${dashboardPath}${apiSuffix}` : '';
	const location = useLocation(); // 获取当前 URL 路径
	const getMenuPath = (pathname: string) => {
		const path = pageSuffix && pathname.endsWith(pageSuffix) ? pathname.slice(0, -pageSuffix.length) : pathname;
		return findMenuItem(navigation, path) ? path : dashboardPath ?? path;
	};
	const [current, setCurrent] = useState(() => getMenuPath(location.pathname)); // 同步选中状态
	const [openKeys, setOpenKeys] = useState<string[]>(() => findParentKeys(navigation, getMenuPath(location.pathname)));
	const navigate = useNavigate();

	const [collapsed, setCollapsed] = useState(false);
	const {
		token: { colorBgContainer },
	} = theme.useToken();
	useEffect(() => {
		const nextLogicalPath = pageSuffix && location.pathname.endsWith(pageSuffix)
			? location.pathname.slice(0, -pageSuffix.length)
			: location.pathname;
		const menuPath = getMenuPath(nextLogicalPath);
		setCurrent(menuPath); // URL 变化时同步菜单高亮
		setOpenKeys(findParentKeys(navigation, menuPath));
	}, [location.pathname]);

	const currentMenuItem = findMenuItem(navigation, current);
	const breadcrumbItems = [
		...(title ? [{ title }] : []),
		...(currentMenuItem ? [{ title: currentMenuItem.label }] : []),
	];

	const onClick: MenuProps['onClick'] = (e) => {
		console.log('click ', e);
		setCurrent(e.key);

		// 对非外部链接的菜单项手动导航
		if (!e.keyPath.some((key) => key === 'external')) {
			navigate(pageUrl(e.key));
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
				<Header style={{ height: 48, padding: '0 24px', lineHeight: '48px', display: 'flex', alignItems: 'center', background: colorBgContainer }}>
					<Breadcrumb items={breadcrumbItems} />
				</Header>
				<Content style={{
					margin: '8px',
					height: '100%',
					overflowY: 'scroll',
				}}>
					{children}
				</Content>
				{initialData?.footer ? <Footer style={{ height: '30px', padding: '2px', textAlign: 'center', overflow: 'hidden' }}>
					{initialData.footer}
				</Footer> : null}
			</Layout>
		</Layout>
	);
}

export default AppRouter;
