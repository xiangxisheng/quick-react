import type { CommonApi } from '@/utils/common/api.js';
import type { AuthState, HeaderAction } from '@shared/types/initial-data.mjs';
import { Avatar, Button, Dropdown, Space } from 'antd';
import { LoginOutlined, LogoutOutlined, UserAddOutlined, UserOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { loginWithAccountsPopup, logoutWithAccounts } from '@/utils/common/passport.js';
import { useState } from 'react';
import LocalLoginModal from '@/components/auth/LocalLoginModal.js';
import { runApiNextAction } from '@/utils/common/response-action.js';
import type { ApiNextAction } from '@shared/types/api-response.mjs';

type AuthActionsProps = {
	auth?: AuthState;
	commonApi: CommonApi;
	apiSuffix: string;
	pageSuffix: string;
};

const icons = { login: <LoginOutlined />, register: <UserAddOutlined />, logout: <LogoutOutlined />, user: <UserOutlined /> };

export default function AuthActions({ auth, commonApi, apiSuffix, pageSuffix }: AuthActionsProps) {
	const [localLoginOpen, setLocalLoginOpen] = useState(false);
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
		if (action.action === 'local-login') { setLocalLoginOpen(true); return; }
		// 弹窗登录：业务页面留在原地，登录成功后刷新当前页。
		if (action.action === 'accounts-login') {
			try {
				const result = await loginWithAccountsPopup();
				runApiNextAction(result.next);
			} catch (error) { await commonApi.modalError([error instanceof Error ? error.message : 'Accounts 登录失败']); }
			return;
		}
		if (action.action === 'local-logout') {
			try {
				const response = await commonApi.apiFetch(`/api/sign${apiSuffix}?logout=local`, { method: 'DELETE' });
				runApiNextAction((await response.json()).next);
			} catch (error) { await commonApi.modalError([error instanceof Error ? error.message : '退出本站失败']); }
			return;
		}
		try {
			const result = await logoutWithAccounts({ signInPath: `/api/accounts/sign${apiSuffix}` }) as { next?: ApiNextAction };
			runApiNextAction(result.next);
		} catch (error) { await commonApi.modalError([error instanceof Error ? error.message : '退出登录失败']); }
	};
	if (auth.component === 'buttons') {
		return <><Space size={4}>
			{identity}
			{auth.actions.map((action) => (
				<Button key={action.key} type="text" icon={action.icon ? icons[action.icon] : undefined} onClick={() => void execute(action)}>{action.label}</Button>
			))}
		</Space><LocalLoginModal open={localLoginOpen} onClose={() => setLocalLoginOpen(false)} commonApi={commonApi} apiSuffix={apiSuffix} /></>;
	}
	if (auth.component === 'dropdown') {
		return <><Dropdown
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
		</Dropdown><LocalLoginModal open={localLoginOpen} onClose={() => setLocalLoginOpen(false)} commonApi={commonApi} apiSuffix={apiSuffix} /></>;
	}
	return null;
}
