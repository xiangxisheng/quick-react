import { useEffect, useState } from 'react';
import { Card, Space, Typography } from 'antd';
import type { CommonApi } from '@/utils/common/api.js';
import type { HomePageData } from '@shared/types/home.mjs';

type HomePageProps = { commonApi: CommonApi; apiSuffix: string };

/** 首页内容全部由后端下发：外部身份源验证时要求首页公开说明应用用途。 */
export default function HomePage({ commonApi, apiSuffix }: HomePageProps) {
	const [home, setHome] = useState<HomePageData>();
	useEffect(() => {
		let active = true;
		commonApi.apiFetch(`/api/home${apiSuffix}`).then(async (response) => {
			const result = await response.json() as { home?: HomePageData };
			if (active && result.home) setHome(result.home);
		}).catch((error) => console.error('加载首页内容失败', error));
		return () => { active = false; };
	}, [commonApi, apiSuffix]);
	if (!home) return null;
	return (
		<div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px 48px' }}>
			<Typography.Title level={2} style={{ marginTop: 0 }}>{home.title}</Typography.Title>
			<Typography.Paragraph style={{ fontSize: 16 }}>{home.summary}</Typography.Paragraph>
			<Space direction="vertical" size={16} style={{ width: '100%' }}>
				{home.sections.map((section) => (
					<Card key={section.key} size="small" title={section.title}>
						<Typography.Paragraph style={{ marginBottom: 0 }}>{section.body}</Typography.Paragraph>
					</Card>
				))}
			</Space>
			{home.links.length ? (
				<Space size={16} style={{ marginTop: 24 }} wrap>
					{home.links.map((link) => {
						const external = /^https?:\/\//.test(link.url);
						return <Typography.Link key={link.key} href={link.url} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{link.label}</Typography.Link>;
					})}
				</Space>
			) : null}
		</div>
	);
}
