import type React from 'react';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, Switch, Typography } from 'antd';
import type { CommonApi } from '@/utils/common/api.js';

export type SettingsField = {
	name: string;
	label: React.ReactNode;
	type: 'text' | 'switch';
	extra?: React.ReactNode;
	placeholder?: string;
	maxLength?: number;
};

type SettingsResponse = {
	config?: Record<string, unknown>;
	settings?: {
		description?: React.ReactNode;
		initialValues: Record<string, unknown>;
		fields: SettingsField[];
	};
};

type SettingsFormProps = {
	commonApi: CommonApi;
	apiPath: string;
	title: React.ReactNode;
	onSaved?: (values: Record<string, unknown>) => void | Promise<void>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
	Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

export default function SettingsForm({ commonApi, apiPath, title, onSaved }: SettingsFormProps) {
	const [form] = Form.useForm<Record<string, unknown>>();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [settings, setSettings] = useState<SettingsResponse['settings']>();

	useEffect(() => {
		let active = true;
		commonApi.apiFetch(apiPath).then(async (response) => {
			const result = await response.json() as SettingsResponse;
			if (active && result.settings) {
				setSettings(result.settings);
				form.setFieldsValue(isRecord(result.config) ? result.config : result.settings.initialValues);
			}
		}).catch((error) => console.error(`加载配置失败: ${apiPath}`, error)).finally(() => {
			if (active) setLoading(false);
		});
		return () => { active = false; };
	}, [apiPath, commonApi, form]);

	const onFinish = async (values: Record<string, unknown>) => {
		setSaving(true);
		try {
			await commonApi.apiFetch(apiPath, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(values),
			});
			await onSaved?.(values);
		} catch (error) {
			console.error(`保存配置失败: ${apiPath}`, error);
		} finally {
			setSaving(false);
		}
	};

	return <Card title={title} loading={loading}>
		{settings?.description ? <Alert type="info" showIcon message={settings.description} style={{ marginBottom: 24 }} /> : null}
		<Form form={form} layout="vertical" onFinish={onFinish} initialValues={settings?.initialValues}>
			{settings?.fields.map((field) => (
				<Form.Item
					key={field.name}
					label={field.label}
					name={field.name}
					extra={field.extra}
					valuePropName={field.type === 'switch' ? 'checked' : 'value'}
				>
					{field.type === 'switch'
						? <Switch checkedChildren="开启" unCheckedChildren="关闭" />
						: <Input placeholder={field.placeholder} maxLength={field.maxLength} />}
				</Form.Item>
			))}
			<Space>
				<Button type="primary" htmlType="submit" loading={saving}>保存配置</Button>
				<Typography.Text type="secondary">修改立即生效</Typography.Text>
			</Space>
		</Form>
	</Card>;
}
