import { Card, Descriptions, Typography } from 'antd';
import type { UserIdentity } from '@shared/types/user.mjs';

type PersonalCenterProps = { user?: UserIdentity; title: string; path: string };

export default function PersonalCenter({ user, title, path }: PersonalCenterProps) {
	const isSecurity = path.endsWith('/security');
	const isSessions = path.endsWith('/sessions');
	return (
		<Card title={title}>
			<Typography.Paragraph>
				{isSecurity ? '管理账户密码和其他安全设置。' : isSessions ? '查看账户登录设备和活动会话。' : '管理当前登录账户的个人信息。'}
			</Typography.Paragraph>
			{isSecurity || isSessions ? null : <Descriptions column={1} bordered>
				<Descriptions.Item label="用户名">{user?.username ?? '—'}</Descriptions.Item>
				<Descriptions.Item label="角色">{user?.roles.join('、') || '—'}</Descriptions.Item>
			</Descriptions>}
		</Card>
	);
}
