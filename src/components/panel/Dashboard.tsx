import { useState, useEffect } from 'react';
import { Card, Col, Row, Statistic, Table } from 'antd';
import type { TableColumnsType } from 'antd';
import type { CommonApi } from '@/utils/common/api.js';
import type { DashboardData } from '@shared/types/dashboard.mjs';

export default function Dashboard({ commonApi, apiPath }: { commonApi: CommonApi; apiPath: string }) {
	const [data, setData] = useState<DashboardData>();
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let active = true;
		commonApi.apiFetch(apiPath)
			.then(async (response) => {
				const result = await response.json() as { dashboard?: DashboardData };
				if (active) setData(result.dashboard);
			})
			.catch((error) => console.error('加载 dashboard 数据失败', error))
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => { active = false; };
	}, [commonApi, apiPath]);

	const columns: TableColumnsType<DashboardData['recentRows'][number]> = data?.recentColumns ?? [];

	return (
		<div>
			<Row gutter={[16, 16]}>
				{data?.statistics.map((item) => (
					<Col xs={24} sm={8} key={item.key}>
						<Card loading={loading}><Statistic title={item.label} value={item.value} /></Card>
					</Col>
				))}
			</Row>
			{data?.recentTitle ? <Card title={data.recentTitle} style={{ marginTop: 16 }} loading={loading}>
				<Table rowKey="key" columns={columns} dataSource={data.recentRows ?? []} pagination={false} />
			</Card> : null}
		</div>
	);
}
