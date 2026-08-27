import type { CommonApi } from '@/utils/common/api.js';
import type { AuthState, HeaderAction } from '@shared/types/initial-data.mjs';
import { Avatar, Button, Dropdown, Space } from 'antd';
import { LoginOutlined, LogoutOutlined, UserAddOutlined, UserOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { runAfterFeedback } from '@/utils/common/feedback.js';
import { loginWithAccountsPopup } from '@/utils/common/passport.js';

type AuthActionsProps = {
	auth?: AuthState;
	commonApi: CommonApi;
	apiSuffix: string;
	pageSuffix: string;
};

const icons = { login: <LoginOutlined />, register: <UserAddOutlined />, logout: <LogoutOutlined />, user: <UserOutlined /> };

export default function AuthActions({ auth, commonApi, apiSuffix, pageSuffix }: AuthActionsProps) {
	const navigate = useNavigate();
	const location = useLocation();
	const logicalPath = pageSuffix && location.pathname.endsWith(pageSuffix)
		? location.pathname.slice(0, -pageSuffix.length)
		: location.pathname;
	const isPersonalCenter = logicalPath === '/panel/me' || logicalPath.startsWith('/panel/me/');
	if (!auth) return null;
	const pageUrl = (path: string) => path === '/' ? path : path + pageSuffix;
	const identity = auth.currentUser
		? <Space size={6}><Avatar size="small" icon={<UserOutlined />} />{auth.currentUser.username}</Space>
		: null;
	const execute = async (action: HeaderAction) => {
		if (action.action === 'navigate') {
			navigate(pageUrl(action.key));
			return;
		}
		// 弹窗登录：业务页面留在原地，登录成功后刷新当前页。
		if (action.action === 'accounts-login') {
			try {
				await loginWithAccountsPopup();
				window.location.reload();
			} catch (error) { await commonApi.modalError([error instanceof Error ? error.message : 'Accounts 登录失败']); }
			return;
		}
		const response = await commonApi.apiFetch('/api' + action.key + apiSuffix, { method: 'DELETE' });
		const result = await response.json() as { feedback?: { redirectAfter?: number } };
		runAfterFeedback(result.feedback, () => window.location.reload());
	};
	if (auth.component === 'buttons') {
		return <Space size={4}>
			{identity}
			{auth.actions.map((action) => (
				<Button key={action.key} type="text" icon={action.icon ? icons[action.icon] : undefined} onClick={() => void execute(action)}>{action.label}</Button>
			))}
		</Space>;
	}
	if (auth.component === 'dropdown') {
		return <Dropdown
			menu={{
				items: auth.actions.map((action) => ({ key: action.key, icon: action.icon ? icons[action.icon] : undefined, label: action.label })),
				onClick: ({ key }) => {
					const action = auth.actions.find((item) => item.key === key);
					if (action) void execute(action);
				},
			}}
			placement="bottomRight"
		>
			<Button type="text" style={{ height: 40, padding: '0 8px', background: isPersonalCenter ? '#e6f4ff' : undefined }}>
				{identity}
			</Button>
		</Dropdown>;
	}
	return null;
}
