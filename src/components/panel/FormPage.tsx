import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, message, Modal, Select, Space, Switch, Typography } from 'antd';
import { ClearOutlined, RollbackOutlined } from '@ant-design/icons';
import type { CommonApi } from '@/utils/common/api.js';
import type { FormPageField, FormPageResponse } from '@shared/types/form-page.mjs';
import { isFieldReadOnly, type FieldLinkOption } from '@shared/field-linkage.mjs';
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

const fieldControl = (field: FormPageField, readOnly: boolean) => {
	if (field.type === 'switch') return <Switch checkedChildren={field.checkedChildren} unCheckedChildren={field.unCheckedChildren} />;
	if (field.type === 'select') return <Select options={field.options?.map((option) => ({ value: option.value, label: option.text }))} placeholder={field.placeholder} />;
	return <Input type={field.type === 'password' ? 'password' : 'text'} placeholder={field.placeholder} maxLength={field.maxLength} readOnly={readOnly} disabled={readOnly} />;
};

export default function FormPage({ commonApi, apiPath, title, submitMethod = 'PUT', redirectOnFeedback = false, onSaved }: FormProps) {
	const [form] = Form.useForm<Record<string, unknown>>();
	const [messageApi, messageContextHolder] = message.useMessage();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [runningAction, setRunningAction] = useState<string>();
	const [formConfig, setFormConfig] = useState<FormResponse['formPage']>();
	const [initialValues, setInitialValues] = useState<Record<string, unknown>>({});
	const [liveValues, setLiveValues] = useState<Record<string, unknown>>({});
	const [dirty, setDirty] = useState(false);
	const [refreshTarget, setRefreshTarget] = useState<string>();
	const refreshSchedule = useRef<{ cancel: () => void } | undefined>(undefined);
	const [refreshDeadline, setRefreshDeadline] = useState<number>();
	const [refreshCancelled, setRefreshCancelled] = useState(false);
	const [saved, setSaved] = useState(false);
	const [responseFeedback, setResponseFeedback] = useState<FormResponse['feedback']>();
	const [passportError, setPassportError] = useState('');
	const passportAutoStarted = useRef(false);
	const changedFields = useRef(new Set<string>());

	useEffect(() => {
		setLoading(true);
		setSaved(false);
		setRefreshTarget(undefined);
		setRefreshDeadline(undefined);
		setRefreshCancelled(false);
		setResponseFeedback(undefined);
		setPassportError('');
		passportAutoStarted.current = false;
		messageApi.destroy('form-feedback');
	}, [apiPath, messageApi]);

	useEffect(() => {
		if (!formConfig?.passportLogin?.enabled || !formConfig.passportLogin.autoStart || passportAutoStarted.current) return;
		passportAutoStarted.current = true;
		const start = async () => {
			try {
				if (!(window as any).Passport) await new Promise<void>((resolve, reject) => { const script = document.createElement('script'); script.src = '/passport.js'; script.onload = () => resolve(); script.onerror = () => reject(new Error('Passport SDK 加载失败')); document.head.appendChild(script); });
				await (window as any).Passport.login({ mode: 'redirect' });
			} catch (error) { setPassportError(error instanceof Error ? error.message : 'Passport 自动登录失败'); }
		};
		void start();
	}, [formConfig]);

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
				setLiveValues(values);
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
				setLiveValues(nextValues);
				form.resetFields();
				form.setFieldsValue(nextValues);
			}
			const target = result.redirectTo ?? await onSaved?.(values);
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
	const runAction = async (key: string) => {
		setRunningAction(key);
		try {
			await commonApi.apiFetch(`${apiPath}?action=${encodeURIComponent(key)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(form.getFieldsValue(true)),
			});
		} catch (error) {
			console.error(`执行配置操作失败: ${apiPath}?action=${key}`, error);
		} finally {
			setRunningAction(undefined);
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
	const loginWithPassport = async () => {
		setPassportError('');
		try {
			if (!(window as any).Passport) await new Promise<void>((resolve, reject) => { const script = document.createElement('script'); script.src = '/passport.js'; script.onload = () => resolve(); script.onerror = () => reject(new Error('Passport SDK 加载失败')); document.head.appendChild(script); });
			await (window as any).Passport.login({ mode: formConfig?.passportLogin?.mode ?? 'popup' });
			window.location.reload();
		} catch (error) { setPassportError(error instanceof Error ? error.message : 'Passport 登录失败'); }
	};
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
		{formConfig?.passportLogin?.enabled ? <div style={{ marginBottom: 16 }}><Button onClick={loginWithPassport}>使用 Passport 登录</Button>{passportError ? <Alert type="error" showIcon message={passportError} style={{ marginTop: 12 }} /> : null}</div> : null}
		{formConfig?.description ? <Alert type="info" showIcon message={formConfig.description} style={{ marginBottom: 24 }} /> : null}
		<Form
			form={form}
			layout="vertical"
			onFinish={onFinish}
			initialValues={formConfig?.initialValues}
			onValuesChange={(changedValues, allValues) => {
				setLiveValues(allValues);
				for (const field of Object.keys(changedValues)) changedFields.current.add(field);
				for (const [name, value] of Object.entries(changedValues)) {
					const option = formConfig?.fields.find((field) => field.name === name)?.options?.find((item) => item.value === String(value));
					if (option?.fieldValues) {
						form.setFieldsValue(option.fieldValues);
						setLiveValues((previous) => ({ ...previous, ...option.fieldValues }));
						for (const field of Object.keys(option.fieldValues)) changedFields.current.add(field);
					}
				}
				setDirty(changedFields.current.size > 0);
			}}
		>
			{formConfig?.fields.map((field) => field.type === 'hidden' ? (
				<Form.Item key={field.name} name={field.name} hidden><Input /></Form.Item>
			) : (() => {
				const sourceOptions = field.readOnlyWhen ? formConfig.fields.find((candidate) => candidate.name === field.readOnlyWhen?.field)?.options as FieldLinkOption[] | undefined : undefined;
				const readOnly = isFieldReadOnly(field.readOnlyWhen, field.readOnlyWhen ? liveValues[field.readOnlyWhen.field] : undefined, sourceOptions);
				return (
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
									setLiveValues((previous) => ({ ...previous, [field.name]: field.type === 'switch' ? false : null }));
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
									setLiveValues((previous) => ({ ...previous, [field.name]: initialValues[field.name] }));
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
					{fieldControl(field, readOnly)}
				</Form.Item>
				);
			})())}
			<Space>
				{formConfig?.actions?.map((action) => <Button key={action.key} loading={runningAction === action.key} disabled={saving || Boolean(runningAction)} onClick={() => runAction(action.key)}>{action.label}</Button>)}
				{!formConfig?.passportLogin?.enabled ? <Button type="primary" htmlType="submit" loading={saving}>{formConfig?.submitLabel}</Button> : null}
				{formConfig?.submitHint ? <Typography.Text type="secondary">{formConfig.submitHint}</Typography.Text> : null}
			</Space>
		</Form>
	</Card>;
}
