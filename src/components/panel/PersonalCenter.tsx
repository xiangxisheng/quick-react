import { Card, Descriptions, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { CommonApi } from '@/utils/common/api.js';
import type { UserIdentity } from '@shared/types/user.mjs';
import { roleLabel } from '@shared/types/role.mjs';

const initialData = (window as Window & { __INITIAL_DATA__?: { apiSuffix?: string } }).__INITIAL_DATA__;
const apiSuffix = initialData?.apiSuffix ?? '';
type PersonalCenterProps = { commonApi: CommonApi; user?: UserIdentity; title: string; path: string };

export default function PersonalCenter({ commonApi, user: initialUser, title, path }: PersonalCenterProps) {
	const [user, setUser] = useState<UserIdentity | undefined>(initialUser);
	const isSecurity = path.endsWith('/security');
	const isSessions = path.endsWith('/sessions');
	useEffect(() => {
		if (isSecurity || isSessions) return;
		let active = true;
		commonApi.apiFetch(`/api/panel/me${apiSuffix}`).then(async (response) => {
			const result = await response.json() as { user?: UserIdentity };
			if (active && result.user) setUser(result.user);
		}).catch((error) => console.error('加载个人中心信息失败', error));
		return () => { active = false; };
	}, [commonApi, isSecurity, isSessions]);
	return (
		<Card title={title}>
			<Typography.Paragraph>
				{isSecurity ? '管理账户密码和其他安全设置。' : isSessions ? '查看账户登录设备和活动会话。' : '管理当前登录账户的个人信息。'}
			</Typography.Paragraph>
			{isSecurity || isSessions ? null : <Descriptions column={1} bordered>
				<Descriptions.Item label="用户名">{user?.username ?? '—'}</Descriptions.Item>
				<Descriptions.Item label="角色">{user?.roles.map(roleLabel).join('、') || '—'}</Descriptions.Item>
			</Descriptions>}
		</Card>
	);
}
