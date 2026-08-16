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
	checkedChildren?: React.ReactNode;
	unCheckedChildren?: React.ReactNode;
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
		submitLabel?: React.ReactNode;
		confirmOnUnchangedSubmit?: string;
		refreshAfterSave?: number | null;
		submitHint?: React.ReactNode;
	feedback?: {
			component?: 'inline' | 'message' | 'modal' | 'none';
			type?: AlertProps['type'];
			showIcon?: boolean;
			title?: string;
			message?: string;
			refreshNowLabel?: React.ReactNode;
			cancelRefreshLabel?: React.ReactNode;
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

const areValuesEqual = (left: Record<string, unknown>, right: Record<string, unknown>) => (
	JSON.stringify(left) === JSON.stringify(right)
);

export default function FormPage({ commonApi, apiPath, title, onSaved }: FormProps) {
	const [form] = Form.useForm<Record<string, unknown>>();
	const [messageApi, messageContextHolder] = message.useMessage();
	const [modalApi, modalContextHolder] = Modal.useModal();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [formConfig, setFormConfig] = useState<FormResponse['form']>();
	const [initialValues, setInitialValues] = useState<Record<string, unknown>>({});
	const [dirty, setDirty] = useState(false);
	const [refreshTarget, setRefreshTarget] = useState<string>();
	const [refreshDeadline, setRefreshDeadline] = useState<number>();
	const [refreshCancelled, setRefreshCancelled] = useState(false);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		setLoading(true);
		setSaved(false);
		setRefreshTarget(undefined);
		setRefreshDeadline(undefined);
		setRefreshCancelled(false);
		Modal.destroyAll();
		messageApi.destroy('form-feedback');
	}, [apiPath, messageApi]);

	useEffect(() => {
		if (!saved || formConfig?.feedback?.component !== 'message') return;
		const feedbackMessage = formConfig.feedback.message ?? '';
		const countdown = refreshDeadline && refreshTarget
			? <CountdownDisplay deadline={refreshDeadline} onFinish={() => window.location.assign(refreshTarget)} />
			: null;
		const refreshValue = countdown ?? (formConfig.refreshAfterSave == null ? '' : formatCountdown(formConfig.refreshAfterSave * 1000));
		const content = renderTemplate(feedbackMessage, { refreshAfterSave: refreshValue });
		messageApi.open({ key: 'form-feedback', type: formConfig.feedback.type ?? 'success', content, duration: 0 });
		return () => messageApi.destroy('form-feedback');
	}, [formConfig, messageApi, refreshDeadline, refreshTarget, saved]);

	useEffect(() => {
		if (!saved || formConfig?.feedback?.component !== 'modal') return;
		if (refreshCancelled) return;
		const feedbackMessage = formConfig.feedback.message ?? '';
		const countdown = refreshDeadline && refreshTarget && !refreshCancelled
			? <CountdownDisplay deadline={refreshDeadline} onFinish={() => window.location.assign(refreshTarget)} />
			: null;
		const refreshValue = refreshCancelled ? '' : countdown ?? (formConfig.refreshAfterSave == null ? '' : formatCountdown(formConfig.refreshAfterSave * 1000));
		const content = renderTemplate(feedbackMessage, { refreshAfterSave: refreshValue });
		Modal.destroyAll();
		modalApi.confirm({
			title: formConfig.feedback.title ?? '',
			content,
			okText: formConfig.feedback.refreshNowLabel,
			cancelText: formConfig.feedback.cancelRefreshLabel,
			onOk: () => window.location.assign(refreshTarget ?? window.location.href),
			onCancel: () => setRefreshCancelled(true),
		});
		return () => Modal.destroyAll();
	}, [formConfig, modalApi, refreshCancelled, refreshDeadline, refreshTarget, saved]);

	useEffect(() => {
		let active = true;
		commonApi.apiFetch(apiPath).then(async (response) => {
			const result = await response.json() as FormResponse;
			if (active && result.form) {
				const values = isRecord(result.currentValues) ? result.currentValues : result.form.initialValues;
				setFormConfig(result.form);
				setInitialValues(values);
				setDirty(false);
				form.setFieldsValue(values);
			}
		}).catch((error) => console.error(`加载配置失败: ${apiPath}`, error)).finally(() => {
			if (active) setLoading(false);
		});
		return () => { active = false; };
	}, [apiPath, commonApi, form]);

	const onFinish = async (values: Record<string, unknown>) => {
		if (!dirty && formConfig?.confirmOnUnchangedSubmit) {
			const confirmed = await commonApi.modalConfirm([formConfig.confirmOnUnchangedSubmit]);
			if (!confirmed) return;
		}
		setSaving(true);
		try {
			await commonApi.apiFetch(apiPath, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(values),
			});
			const target = await onSaved?.(values);
			setInitialValues(values);
			setDirty(false);
			setSaved(true);
			const refreshAfterSave = formConfig?.refreshAfterSave ?? null;
			if (target && refreshAfterSave !== null) {
				setRefreshCancelled(false);
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

	const feedback = formConfig?.feedback;
	const feedbackMessage = feedback?.message ?? '';
	const alertCountdown = refreshDeadline && refreshTarget
		? <CountdownDisplay deadline={refreshDeadline} onFinish={() => window.location.assign(refreshTarget)} />
		: null;
	const refreshValue = alertCountdown ?? (formConfig?.refreshAfterSave == null ? '' : formatCountdown(formConfig.refreshAfterSave * 1000));
	const feedbackContent = renderTemplate(feedbackMessage, { refreshAfterSave: refreshValue });
	const inlineFeedback = saved && feedback?.component === 'inline'
			? <Alert type={feedback.type ?? 'success'} showIcon={feedback.showIcon} message={feedbackContent} style={{ marginBottom: 24 }} />
		: null;

	return <Card title={title} loading={loading}>
		{messageContextHolder}
		{modalContextHolder}
		{inlineFeedback}
		{formConfig?.description ? <Alert type="info" showIcon message={formConfig.description} style={{ marginBottom: 24 }} /> : null}
		<Form
			form={form}
			layout="vertical"
			onFinish={onFinish}
			initialValues={formConfig?.initialValues}
			onValuesChange={(_, values) => setDirty(!areValuesEqual(values, initialValues))}
		>
			{formConfig?.fields.map((field) => (
				<Form.Item
					key={field.name}
					label={field.label}
					name={field.name}
					extra={field.extra}
					valuePropName={field.type === 'switch' ? 'checked' : 'value'}
				>
					{field.type === 'switch'
						? <Switch checkedChildren={field.checkedChildren} unCheckedChildren={field.unCheckedChildren} />
						: <Input placeholder={field.placeholder} maxLength={field.maxLength} />}
				</Form.Item>
			))}
			<Space>
				<Button type="primary" htmlType="submit" loading={saving}>{formConfig?.submitLabel}</Button>
				{formConfig?.submitHint ? <Typography.Text type="secondary">{formConfig.submitHint}</Typography.Text> : null}
			</Space>
		</Form>
	</Card>;
}
