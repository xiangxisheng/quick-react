import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, message, Modal, Space, Switch, Typography } from 'antd';
import type { AlertProps } from 'antd';
import type { CommonApi } from '@/utils/common/api.js';

export type FormField = {
	name: string;
	label: React.ReactNode;
	type: 'text' | 'switch';
	extra?: React.ReactNode;
	placeholder?: string;
	maxLength?: number;
};

const formatCountdown = (value: string | number) => Math.max(0, Number(value) / 1000).toFixed(1);

const renderTemplate = (template: string, values: Record<string, React.ReactNode>) => template
	.split(/(\{[^{}]+\})/g)
	.map((part, index) => {
		const match = /^\{([^{}]+)\}$/.exec(part);
		return match && match[1] in values ? <React.Fragment key={`${part}-${index}`}>{values[match[1]]}</React.Fragment> : part;
	});

const CountdownDisplay = ({ deadline, onFinish }: { deadline: number; onFinish: () => void }) => {
	const [remaining, setRemaining] = useState(() => Math.max(0, deadline - Date.now()));

	useEffect(() => {
		let finished = false;
		const timer = window.setInterval(() => {
			const next = Math.max(0, deadline - Date.now());
			setRemaining(next);
			if (next === 0 && !finished) {
				finished = true;
				window.clearInterval(timer);
				onFinish();
			}
		}, 100);
		return () => window.clearInterval(timer);
	}, [deadline, onFinish]);

	return <span>{formatCountdown(remaining)}</span>;
};

type FormResponse = {
	currentValues?: Record<string, unknown>;
	form?: {
		description?: React.ReactNode;
		refreshAfterSave?: number | null;
		submitHint?: React.ReactNode;
		saveFeedback?: {
			component?: 'inline' | 'message' | 'modal' | 'none';
			type?: AlertProps['type'];
			showIcon?: boolean;
			message?: string;
		};
		initialValues: Record<string, unknown>;
		fields: FormField[];
	};
};

type FormProps = {
	commonApi: CommonApi;
	apiPath: string;
	title: React.ReactNode;
	onSaved?: (values: Record<string, unknown>) => string | undefined | Promise<string | undefined>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
	Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

export default function FormPage({ commonApi, apiPath, title, onSaved }: FormProps) {
	const [form] = Form.useForm<Record<string, unknown>>();
	const [messageApi, messageContextHolder] = message.useMessage();
	const [modalApi, modalContextHolder] = Modal.useModal();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [formConfig, setFormConfig] = useState<FormResponse['form']>();
	const [refreshTarget, setRefreshTarget] = useState<string>();
	const [refreshDeadline, setRefreshDeadline] = useState<number>();
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		if (!saved || formConfig?.saveFeedback?.component !== 'message') return;
		const feedbackMessage = formConfig.saveFeedback.message ?? '保存成功';
		const countdown = refreshDeadline && refreshTarget
			? <CountdownDisplay deadline={refreshDeadline} onFinish={() => window.location.assign(refreshTarget)} />
			: null;
		const refreshValue = countdown ?? (formConfig.refreshAfterSave == null ? '' : formatCountdown(formConfig.refreshAfterSave * 1000));
		const content = renderTemplate(feedbackMessage, { refreshAfterSave: refreshValue });
		messageApi.open({ key: 'form-save-feedback', type: formConfig.saveFeedback.type ?? 'success', content, duration: 0 });
		return () => messageApi.destroy('form-save-feedback');
	}, [formConfig, messageApi, refreshDeadline, refreshTarget, saved]);

	useEffect(() => {
		if (!saved || formConfig?.saveFeedback?.component !== 'modal') return;
		const feedbackMessage = formConfig.saveFeedback.message ?? '保存成功';
		const countdown = refreshDeadline && refreshTarget
			? <CountdownDisplay deadline={refreshDeadline} onFinish={() => window.location.assign(refreshTarget)} />
			: null;
		const refreshValue = countdown ?? (formConfig.refreshAfterSave == null ? '' : formatCountdown(formConfig.refreshAfterSave * 1000));
		const content = renderTemplate(feedbackMessage, { refreshAfterSave: refreshValue });
		Modal.destroyAll();
		modalApi.success({ title: '保存结果', content });
		return () => Modal.destroyAll();
	}, [formConfig, modalApi, refreshDeadline, refreshTarget, saved]);

	useEffect(() => {
		let active = true;
		commonApi.apiFetch(apiPath).then(async (response) => {
			const result = await response.json() as FormResponse;
			if (active && result.form) {
				setFormConfig(result.form);
				form.setFieldsValue(isRecord(result.currentValues) ? result.currentValues : result.form.initialValues);
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
			const target = await onSaved?.(values);
			setSaved(true);
			const refreshAfterSave = formConfig?.refreshAfterSave ?? null;
			if (target && refreshAfterSave !== null) {
				const seconds = Number.isFinite(refreshAfterSave) ? Math.max(0, Math.floor(refreshAfterSave)) : 0;
				if (seconds === 0) window.location.assign(target);
				else {
					setRefreshTarget(target);
					setRefreshDeadline(Date.now() + seconds * 1000);
				}
			}
		} catch (error) {
			console.error(`保存配置失败: ${apiPath}`, error);
		} finally {
			setSaving(false);
		}
	};

	const feedback = formConfig?.saveFeedback;
	const feedbackMessage = feedback?.message ?? '保存成功';
	const alertCountdown = refreshDeadline && refreshTarget
		? <CountdownDisplay deadline={refreshDeadline} onFinish={() => window.location.assign(refreshTarget)} />
		: null;
	const refreshValue = alertCountdown ?? (formConfig?.refreshAfterSave == null ? '' : formatCountdown(formConfig.refreshAfterSave * 1000));
	const feedbackContent = renderTemplate(feedbackMessage, { refreshAfterSave: refreshValue });
	const saveFeedback = saved && feedback?.component === 'inline'
			? <Alert type={feedback.type ?? 'success'} showIcon={feedback.showIcon} message={feedbackContent} style={{ marginBottom: 24 }} />
		: null;

	return <Card title={title} loading={loading}>
		{messageContextHolder}
		{modalContextHolder}
		{saveFeedback}
		{formConfig?.description ? <Alert type="info" showIcon message={formConfig.description} style={{ marginBottom: 24 }} /> : null}
		<Form form={form} layout="vertical" onFinish={onFinish} initialValues={formConfig?.initialValues}>
			{formConfig?.fields.map((field) => (
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
				{formConfig?.submitHint ? <Typography.Text type="secondary">{formConfig.submitHint}</Typography.Text> : null}
			</Space>
		</Form>
	</Card>;
}
