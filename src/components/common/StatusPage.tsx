import type React from 'react';
import { useEffect, useState } from 'react';
import { Button, Result, Space } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { HomeOutlined, LoginOutlined, UserOutlined } from '@ant-design/icons';
import type { CommonApi } from '@/utils/common/api.js';
import type { HeaderAction, PageStatus } from '@shared/types/initial-data.mjs';
import { isSilentPassportError, loginWithAccountsPopup } from '@/utils/common/passport.js';
import LocalLoginModal from '@/components/auth/LocalLoginModal.js';
import { runApiNextAction } from '@/utils/common/response-action.js';

type StatusPageProps = {
	commonApi: CommonApi;
	apiSuffix: string;
	pageSuffix: string;
	pageStatus?: PageStatus;
};

const icons: Record<string, React.ReactNode> = { login: <LoginOutlined />, user: <UserOutlined />, home: <HomeOutlined /> };
const resultStatus = (status: number) => status === 404 ? '404' as const : status >= 500 ? '500' as const : '403' as const;

// 页面路径不存在、未登录或无权访问时的统一提示，提示文案由后端下发。
export default function StatusPage({ commonApi, apiSuffix, pageSuffix, pageStatus }: StatusPageProps) {
	const location = useLocation();
	const navigate = useNavigate();
	const serverStatus = pageStatus?.path === location.pathname ? pageStatus : undefined;
	const [status, setStatus] = useState<PageStatus | undefined>(serverStatus);
	const [localLoginOpen, setLocalLoginOpen] = useState(false);

	useEffect(() => {
		if (serverStatus) {
			setStatus(serverStatus);
			return;
		}
		let active = true;
		setStatus(undefined);
		commonApi.apiFetch(`/api/page-status${apiSuffix}?path=${encodeURIComponent(location.pathname)}`)
			.then(async (response) => {
				const result = await response.json() as { pageStatus?: PageStatus };
				if (active) setStatus(result.pageStatus);
			})
			.catch((error) => console.error('加载页面状态失败', error));
		return () => { active = false; };
	}, [commonApi, apiSuffix, location.pathname, serverStatus]);

	if (!status) return null;
	const pageUrl = (path: string) => path === '/' ? path : `${path}${pageSuffix}`;
	const execute = async (action: HeaderAction) => {
		if (action.action === 'navigate') { navigate(pageUrl(action.key)); return; }
		if (action.action === 'local-login') { setLocalLoginOpen(true); return; }
		// 需要登录的页面直接弹出 Accounts 登录窗口，不再把用户送到登录页。
		if (action.action === 'accounts-login') {
			try {
				const result = await loginWithAccountsPopup();
				runApiNextAction(result.next);
			} catch (error) { if (!isSilentPassportError(error)) await commonApi.modalError([error instanceof Error ? error.message : 'Accounts 登录失败']); }
			return;
		}
		if (action.action === 'local-logout') {
			try {
				const response = await commonApi.apiFetch(`/api/sign${apiSuffix}?logout=local`, { method: 'DELETE' });
				runApiNextAction((await response.json()).next);
			} catch (error) { await commonApi.modalError([error instanceof Error ? error.message : '退出本站失败']); }
			return;
		}
		if (action.action === 'all-logout') {
			try {
				const response = await commonApi.apiFetch(`/api/sign${apiSuffix}`, { method: 'DELETE' });
				runApiNextAction((await response.json()).next);
			} catch (error) { await commonApi.modalError([error instanceof Error ? error.message : '退出登录失败']); }
			return;
		}
		try {
			const response = await commonApi.apiFetch(`/api/accounts/sign${apiSuffix}`, { method: 'DELETE' });
			runApiNextAction((await response.json()).next);
		} catch (error) { await commonApi.modalError([error instanceof Error ? error.message : '退出 Accounts 失败']); }
	};
	return <><Result
		status={resultStatus(status.status)}
		title={status.title}
		subTitle={status.description}
		extra={<Space size={8}>
			{status.actions.map((action, index) => (
				<Button
					key={action.key}
					type={index === 0 ? 'primary' : 'default'}
					icon={icons[action.icon ?? 'home'] ?? icons.home}
					onClick={() => void execute(action)}
				>{action.label}</Button>
			))}
		</Space>}
	/><LocalLoginModal open={localLoginOpen} onClose={() => setLocalLoginOpen(false)} commonApi={commonApi} apiSuffix={apiSuffix} /></>;
}
