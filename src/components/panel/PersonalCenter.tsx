import { Alert, Button, Card, Descriptions, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { CommonApi } from '@/utils/common/api.js';
import type { AccountCenterLink, UserIdentity } from '@shared/types/user.mjs';
import { roleLabel } from '@shared/types/role.mjs';

const initialData = (window as Window & { __INITIAL_DATA__?: { apiSuffix?: string } }).__INITIAL_DATA__;
const apiSuffix = initialData?.apiSuffix ?? '';
type PersonalCenterProps = { commonApi: CommonApi; user?: UserIdentity; title: string; path: string };

export default function PersonalCenter({ commonApi, user: initialUser, title, path }: PersonalCenterProps) {
	const [user, setUser] = useState<UserIdentity | undefined>(initialUser);
	const [accountsCenter, setAccountsCenter] = useState<AccountCenterLink>();
	const isSecurity = path.endsWith('/security');
	const isSessions = path.endsWith('/sessions');
	useEffect(() => {
		let active = true;
		commonApi.apiFetch(`/api/panel/me${apiSuffix}`).then(async (response) => {
			const result = await response.json() as { user?: UserIdentity; accountsCenter?: AccountCenterLink };
			if (!active) return;
			if (result.user) setUser(result.user);
			setAccountsCenter(result.accountsCenter);
		}).catch((error) => console.error('加载个人中心信息失败', error));
		return () => { active = false; };
	}, [commonApi]);
	return (
		<Card title={title}>
			{/* 站点启用 Accounts 登录后，账号资料由 Accounts 统一维护，本站只做只读展示。 */}
			{accountsCenter ? <Alert
				type="info"
				showIcon
				style={{ marginBottom: 16 }}
				message="账号资料由 Accounts 账号中心统一维护"
				description="用户名、昵称、密码和邮箱的添加、验证、解绑均在 Accounts 账号中心完成，本站仅展示当前登录身份。账号中心将在新标签页打开，不会离开当前页面。"
				action={<Button type="primary" href={accountsCenter.url} target="_blank" rel="noopener noreferrer">{accountsCenter.label}</Button>}
			/> : null}
			{/* 账号资料交给 Accounts 后，本站不再重复这些占位说明。 */}
			{accountsCenter ? null : <Typography.Paragraph>
				{isSecurity ? '管理账户密码和其他安全设置。' : isSessions ? '查看账户登录设备和活动会话。' : '管理当前登录账户的个人信息。'}
			</Typography.Paragraph>}
			{isSecurity || isSessions ? null : <Descriptions column={1} bordered>
				<Descriptions.Item label="用户名">{user?.username ?? '—'}</Descriptions.Item>
				<Descriptions.Item label="角色">{user?.roles.map(roleLabel).join('、') || '—'}</Descriptions.Item>
			</Descriptions>}
		</Card>
	);
}
