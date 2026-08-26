import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, message, Modal, Select, Space, Switch, Typography } from 'antd';
import { ClearOutlined, RollbackOutlined } from '@ant-design/icons';
import type { CommonApi } from '@/utils/common/api.js';
import type { FormPageResponse } from '@shared/types/form-page.mjs';
import { changedFieldsKey, type ChangedFieldsPayload } from '@shared/types/changed-fields.mjs';
import { CountdownDisplay, formatCountdown } from '@/components/common/Countdown.js';
import { runAfterFeedback } from '@/utils/common/feedback.js';

const renderTemplate = (template: string, values: Record<string, React.ReactNode>) => template
	.split(/(\{[^{}]+\})/g)
	.map((part, index) => {
		const match = /^\{([^{}]+)\}$/.exec(part);
		return match && match[1] in values ? <React.Fragment key={`${part}-${index}`}>{values[match[1]]}</React.Fragment> : part;
	});

type FormResponse = FormPageResponse;

type FormProps = {
	commonApi: CommonApi;
	apiPath: string;
	title: React.ReactNode;
	submitMethod?: 'POST' | 'PUT';
	redirectOnFeedback?: boolean;
	onSaved?: (values: Record<string, unknown>) => string | undefined | Promise<string | undefined>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
	Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

export default function FormPage({ commonApi, apiPath, title, submitMethod = 'PUT', redirectOnFeedback = false, onSaved }: FormProps) {
	const [form] = Form.useForm<Record<string, unknown>>();
	const [messageApi, messageContextHolder] = message.useMessage();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [formConfig, setFormConfig] = useState<FormResponse['formPage']>();
	const [initialValues, setInitialValues] = useState<Record<string, unknown>>({});
	const [dirty, setDirty] = useState(false);
	const [refreshTarget, setRefreshTarget] = useState<string>();
	const refreshSchedule = useRef<{ cancel: () => void } | undefined>(undefined);
	const [refreshDeadline, setRefreshDeadline] = useState<number>();
	const [refreshCancelled, setRefreshCancelled] = useState(false);
	const [saved, setSaved] = useState(false);
	const [responseFeedback, setResponseFeedback] = useState<FormResponse['feedback']>();
	const changedFields = useRef(new Set<string>());

	useEffect(() => {
		setLoading(true);
		setSaved(false);
		setRefreshTarget(undefined);
		setRefreshDeadline(undefined);
		setRefreshCancelled(false);
		setResponseFeedback(undefined);
		messageApi.destroy('form-feedback');
	}, [apiPath, messageApi]);

	useEffect(() => {
		const feedback = responseFeedback;
		if (!saved || feedback?.component !== 'message') return;
		const feedbackMessage = feedback.message ?? '';
		const countdown = refreshDeadline && refreshTarget
			? <CountdownDisplay deadline={refreshDeadline} onFinish={() => undefined} />
			: null;
		const refreshValue = countdown ?? (refreshDeadline ? formatCountdown(Math.max(0, refreshDeadline - Date.now())) : '');
		const content = renderTemplate(feedbackMessage, { redirectAfter: refreshValue });
		messageApi.open({ key: 'form-feedback', type: feedback.type ?? 'success', content, duration: 0 });
		return () => messageApi.destroy('form-feedback');
	}, [formConfig, messageApi, refreshDeadline, refreshTarget, responseFeedback, saved]);

	useEffect(() => {
		let active = true;
		commonApi.apiFetch(apiPath).then(async (response) => {
			const result = await response.json() as FormResponse;
			if (active && result.formPage) {
				const values = isRecord(result.currentValues) ? result.currentValues : result.formPage.initialValues;
				setFormConfig(result.formPage);
				setInitialValues(values);
				setDirty(false);
				changedFields.current.clear();
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
			const response = await commonApi.apiFetch(apiPath, {
				method: submitMethod,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...values, [changedFieldsKey]: [...changedFields.current] } satisfies ChangedFieldsPayload & Record<string, unknown>),
			});
			const result = await response.json() as FormResponse;
			Modal.destroyAll();
			setResponseFeedback(result.feedback);
			if (result.formPage) {
				const nextValues = isRecord(result.currentValues) ? result.currentValues : result.formPage.initialValues;
				setFormConfig(result.formPage);
				setInitialValues(nextValues);
				form.resetFields();
				form.setFieldsValue(nextValues);
			}
			const target = await onSaved?.(values);
			const savedValues = isRecord(result.currentValues) ? result.currentValues : values;
			setInitialValues(savedValues);
			changedFields.current.clear();
			setDirty(false);
			setSaved(true);
			if (target && result.feedback && (redirectOnFeedback || result.feedback.redirectAfter !== undefined)) {
				const schedule = runAfterFeedback(result.feedback, () => window.location.assign(target));
				refreshSchedule.current = schedule;
				setRefreshCancelled(false);
				setRefreshTarget(target);
				setRefreshDeadline(schedule.deadline);
			}
		} catch (error) {
			console.error(`保存配置失败: ${apiPath}`, error);
		} finally {
			setSaving(false);
		}
	};

	const feedback = responseFeedback;
	const feedbackMessage = feedback?.message ?? '';
	const alertCountdown = refreshDeadline && refreshTarget
		? <CountdownDisplay deadline={refreshDeadline} onFinish={() => undefined} />
		: null;
	const refreshValue = alertCountdown ?? (refreshDeadline ? formatCountdown(Math.max(0, refreshDeadline - Date.now())) : '');
	const feedbackContent = renderTemplate(feedbackMessage, { redirectAfter: refreshValue });
	const inlineFeedback = saved && feedback?.component === 'inline'
			? <Alert type={feedback.type ?? 'success'} showIcon={feedback.showIcon} message={feedbackContent} style={{ marginBottom: 24 }} />
		: null;
	const modalFeedback = saved && !refreshCancelled && feedback?.component === 'modal' ? (
		<Modal
			open
			title={feedback.title ?? ''}
			okText={feedback.refreshNowLabel}
			cancelText={feedback.cancelRefreshLabel}
			onOk={() => window.location.assign(refreshTarget ?? window.location.href)}
			onCancel={() => { refreshSchedule.current?.cancel(); setRefreshCancelled(true); }}
		>
			{feedbackContent}
		</Modal>
	) : null;

	return <Card title={title} loading={loading}>
		{messageContextHolder}
		{modalFeedback}
		{inlineFeedback}
		{formConfig?.description ? <Alert type="info" showIcon message={formConfig.description} style={{ marginBottom: 24 }} /> : null}
		<Form
			form={form}
			layout="vertical"
			onFinish={onFinish}
			initialValues={formConfig?.initialValues}
			onValuesChange={(changedValues) => {
				for (const field of Object.keys(changedValues)) changedFields.current.add(field);
				setDirty(changedFields.current.size > 0);
			}}
		>
			{formConfig?.fields.map((field) => field.type === 'hidden' ? (
				<Form.Item key={field.name} name={field.name} hidden><Input /></Form.Item>
			) : (
				<Form.Item
					key={field.name}
					label={(
						<Space size={2}>
							<span>{field.label}</span>
							<Button
								type="text"
								size="small"
								title="清空"
								icon={<ClearOutlined />}
								onClick={() => {
									form.setFields([{ name: field.name, value: field.type === 'switch' ? false : null, touched: true }]);
									changedFields.current.add(field.name);
									setDirty(true);
								}}
							/>
							<Button
								type="text"
								size="small"
								title="还原"
								icon={<RollbackOutlined />}
								onClick={() => {
									form.setFields([{ name: field.name, value: initialValues[field.name], touched: false, errors: [] }]);
									changedFields.current.delete(field.name);
									setDirty(changedFields.current.size > 0);
								}}
							/>
						</Space>
					)}
					name={field.name}
					extra={field.extra}
					valuePropName={field.type === 'switch' ? 'checked' : 'value'}
					rules={field.rules}
				>
					{field.type === 'switch'
						? <Switch checkedChildren={field.checkedChildren} unCheckedChildren={field.unCheckedChildren} />
						: field.type === 'select'
							? <Select options={field.options?.map((option) => ({ value: option.value, label: option.text }))} placeholder={field.placeholder} />
						: <Input type={field.type === 'password' ? 'password' : 'text'} placeholder={field.placeholder} maxLength={field.maxLength} />}
				</Form.Item>
			))}
			<Space>
				<Button type="primary" htmlType="submit" loading={saving}>{formConfig?.submitLabel}</Button>
				{formConfig?.submitHint ? <Typography.Text type="secondary">{formConfig.submitHint}</Typography.Text> : null}
			</Space>
		</Form>
	</Card>;
}
