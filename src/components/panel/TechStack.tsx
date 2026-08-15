import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, Switch, Typography } from 'antd';
import type { CommonApi } from '@/utils/common/api.js';

type TechStackConfig = { nginx: boolean; phpVersion: string; apiSuffix: string; pageSuffix: string };

const initialData = (window as Window & { __INITIAL_DATA__?: { apiSuffix?: string } }).__INITIAL_DATA__;
const apiPath = `/api/panel/tech-stack${initialData?.apiSuffix ?? ''}`;

export default function TechStack({ commonApi }: { commonApi: CommonApi }) {
	const [form] = Form.useForm<TechStackConfig>();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		let active = true;
		commonApi.apiFetch(apiPath).then(async (response) => {
			const result = await response.json() as { config?: TechStackConfig };
			if (active) form.setFieldsValue(result.config ?? { nginx: false, phpVersion: '', apiSuffix: '.php', pageSuffix: '.html' });
		}).catch((error) => console.error('加载技术栈伪装配置失败', error)).finally(() => {
			if (active) setLoading(false);
		});
		return () => { active = false; };
	}, [commonApi, form]);

	const onFinish = async (values: TechStackConfig) => {
		setSaving(true);
		try {
			await commonApi.apiFetch(apiPath, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(values),
			});
			// 后缀可能已改变，切换到新的页面地址让前端路由立即使用新配置。
			window.location.assign(`/panel/tech-stack${values.pageSuffix}`);
		} catch (error) {
			console.error('保存技术栈伪装配置失败', error);
		} finally {
			setSaving(false);
		}
	};

	return <Card title="技术栈伪装" loading={loading}>
		<Alert type="info" showIcon message="配置会作用于后续 HTTP 响应，并保存到服务器配置文件。仅用于兼容性测试、演示或隐藏真实服务实现。" style={{ marginBottom: 24 }} />
		<Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ nginx: false, phpVersion: '' }}>
			<Form.Item label="Nginx" name="nginx" valuePropName="checked" extra="开启后返回 Server: nginx。">
				<Switch checkedChildren="开启" unCheckedChildren="关闭" />
			</Form.Item>
			<Form.Item label="PHP 版本号" name="phpVersion" extra="填写例如 8.2.12；留空则不返回 PHP 标识。">
				<Input placeholder="例如 8.2.12" maxLength={32} />
			</Form.Item>
			<Form.Item label="API 路径后缀" name="apiSuffix" extra="例如 .php、.json；留空则使用无后缀 API 路径。">
				<Input placeholder="例如 .php" maxLength={16} />
			</Form.Item>
			<Form.Item label="页面路径后缀" name="pageSuffix" extra="例如 .html；留空则使用无后缀页面路径。">
				<Input placeholder="例如 .html" maxLength={16} />
			</Form.Item>
			<Space>
				<Button type="primary" htmlType="submit" loading={saving}>保存配置</Button>
				<Typography.Text type="secondary">修改立即生效</Typography.Text>
			</Space>
		</Form>
	</Card>;
}
