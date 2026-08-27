import { Alert, Button, Card, Descriptions } from 'antd';
import { useEffect, useState } from 'react';
import type { CommonApi } from '@/utils/common/api.js';
import type { AccountCenterLink, UserIdentity } from '@shared/types/user.mjs';
import { roleLabel } from '@shared/types/role.mjs';

const initialData = (window as Window & { __INITIAL_DATA__?: { apiSuffix?: string } }).__INITIAL_DATA__;
const apiSuffix = initialData?.apiSuffix ?? '';
type PersonalCenterProps = { commonApi: CommonApi; user?: UserIdentity; title: string };
type MeResponse = { user?: UserIdentity; accountsNotice?: string; accountsCenter?: AccountCenterLink };

/** 只读展示当前登录身份；账号资料在 Accounts 账号中心维护，入口始终在新页面打开。 */
export default function PersonalCenter({ commonApi, user: initialUser, title }: PersonalCenterProps) {
	const [user, setUser] = useState<UserIdentity | undefined>(initialUser);
	const [notice, setNotice] = useState('');
	const [accountsCenter, setAccountsCenter] = useState<AccountCenterLink>();
	useEffect(() => {
		let active = true;
		commonApi.apiFetch(`/api/panel/me${apiSuffix}`).then(async (response) => {
			const result = await response.json() as MeResponse;
			if (!active) return;
			if (result.user) setUser(result.user);
			setNotice(result.accountsNotice ?? '');
			setAccountsCenter(result.accountsCenter);
		}).catch((error) => console.error('加载个人中心信息失败', error));
		return () => { active = false; };
	}, [commonApi]);
	return (
		<Card title={title} style={{ maxWidth: 720, margin: '24px auto' }}>
			{notice ? <Alert
				type="info"
				showIcon
				style={{ marginBottom: 16 }}
				message={notice}
				action={accountsCenter ? <Button href={accountsCenter.url} target="_blank" rel="noopener noreferrer">{accountsCenter.label}</Button> : undefined}
			/> : null}
			<Descriptions column={1} bordered>
				<Descriptions.Item label="用户名">{user?.username ?? '—'}</Descriptions.Item>
				<Descriptions.Item label="角色">{user?.roles.map(roleLabel).join('、') || '—'}</Descriptions.Item>
			</Descriptions>
		</Card>
	);
}
