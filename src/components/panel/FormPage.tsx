import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Divider, Form, Input, message, Modal, Select, Space, Spin, Switch, Typography } from 'antd';
import { ClearOutlined, GoogleCircleFilled, RollbackOutlined, SendOutlined, UserOutlined, WechatFilled } from '@ant-design/icons';
import type { CommonApi } from '@/utils/common/api.js';
import type { FormPageField, FormPageResponse } from '@shared/types/form-page.mjs';
import { isFieldReadOnly, type FieldLinkOption } from '@shared/field-linkage.mjs';
import { changedFieldsKey, type ChangedFieldsPayload } from '@shared/types/changed-fields.mjs';
import { CountdownDisplay, formatCountdown } from '@/components/common/Countdown.js';
import { runAfterFeedback } from '@/utils/common/feedback.js';
import { loginWithAccountsPopup } from '@/utils/common/passport.js';
import { runApiNextAction } from '@/utils/common/response-action.js';

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
	onCompleted?: () => void | Promise<void>;
	embedded?: boolean;
};

/** 第三方登录图标按 key 渲染，未登记的身份源用通用图标兜底。 */
const externalLoginIcons: Record<string, { icon: React.ReactNode; color: string }> = {
	wechat: { icon: <WechatFilled />, color: '#07C160' },
	google: { icon: <GoogleCircleFilled />, color: '#4285F4' },
	telegram: { icon: <SendOutlined />, color: '#229ED9' },
};

const hasInitialValue = (value: unknown) => value !== undefined && value !== null && value !== '' && value !== false;

/** apiPath 可能已经带查询串（例如登录页的 ?mode=sign），必须按 URL 规则追加 action。 */
const actionPath = (apiPath: string, action: string) => {
	const url = new URL(apiPath, window.location.origin);
	url.searchParams.set('action', action);
	return `${url.pathname}${url.search}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
	Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const fieldControl = (field: FormPageField, readOnly: boolean) => {
	if (field.type === 'switch') return <Switch checkedChildren={field.checkedChildren} unCheckedChildren={field.unCheckedChildren} />;
	if (field.type === 'select') return <Select options={field.options?.map((option) => ({ value: option.value, label: option.text }))} placeholder={field.placeholder} />;
	return <Input type={field.type === 'password' ? 'password' : 'text'} placeholder={field.placeholder} maxLength={field.maxLength} readOnly={readOnly} disabled={readOnly} />;
};

export default function FormPage({ commonApi, apiPath, title, submitMethod = 'PUT', redirectOnFeedback = false, onSaved, onCompleted, embedded = false }: FormProps) {
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
	const changedFields = useRef(new Set<string>());

	useEffect(() => {
		setLoading(true);
		setSaved(false);
		setRefreshTarget(undefined);
		setRefreshDeadline(undefined);
		setRefreshCancelled(false);
		setResponseFeedback(undefined);
		setPassportError('');
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

	// 后端返回新的 formPage 表示流程还在继续，这时不安排跳转，避免多步表单在中间步骤被反馈倒计时带走。
	const applyResult = async (result: FormResponse, values: Record<string, unknown>) => {
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
		// 弹窗里的流程结束后先尝试关闭窗口，关不掉（不是脚本打开的窗口）再回落到跳转。
		if (result.closeWindow) {
			window.close();
			if (result.redirectTo) window.setTimeout(() => { if (!window.closed) window.location.assign(result.redirectTo!); }, 300);
			return;
		}
		if (result.openWindow && result.redirectTo) {
			const popup = window.open(result.redirectTo, 'accounts_email_bind', 'width=480,height=680,resizable=yes,scrollbars=yes');
			if (!popup) setPassportError('授权窗口被浏览器拦截');
			return;
		}
		const target = result.redirectTo ?? (result.formPage ? undefined : await onSaved?.(values));
		const savedValues = isRecord(result.currentValues) ? result.currentValues : values;
		setInitialValues(savedValues);
		changedFields.current.clear();
		setDirty(false);
		setSaved(true);
		if (!result.formPage) {
			if (onCompleted) await onCompleted();
			if (result.next) { runApiNextAction(result.next); return; }
			if (onCompleted) return;
		}
		if (target && result.feedback && (redirectOnFeedback || result.feedback.redirectAfter !== undefined)) {
			const schedule = runAfterFeedback(result.feedback, () => window.location.assign(target));
			refreshSchedule.current = schedule;
			setRefreshCancelled(false);
			setRefreshTarget(target);
			setRefreshDeadline(schedule.deadline);
		}
	};

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
			await applyResult(await response.json() as FormResponse, values);
		} catch (error) {
			console.error(`保存配置失败: ${apiPath}`, error);
		} finally {
			setSaving(false);
		}
	};
	const runAction = async (key: string) => {
		setRunningAction(key);
		const values = form.getFieldsValue(true) as Record<string, unknown>;
		try {
			const response = await commonApi.apiFetch(actionPath(apiPath, key), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...values, [changedFieldsKey]: [...changedFields.current] } satisfies ChangedFieldsPayload & Record<string, unknown>),
			});
			await applyResult(await response.json() as FormResponse, values);
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
			const result = await loginWithAccountsPopup();
			runApiNextAction(result.next);
		} catch (error) {
			if ((error as Error & { silent?: boolean })?.silent) return;
			setPassportError(error instanceof Error ? error.message : 'Passport 登录失败');
		}
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

	const content = <>
		{messageContextHolder}
		{modalFeedback}
		{inlineFeedback}
		{/* 跳转到 Accounts 必须由用户点击确认，页面不会自动跳走。 */}
		{formConfig?.passportLogin?.enabled ? <div style={{ marginBottom: 16 }}>
			<Button type="primary" onClick={loginWithPassport}>使用 Passport 登录</Button>
			{passportError ? <Alert type="error" showIcon message={passportError} style={{ marginTop: 12 }} /> : null}
		</div> : null}
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
							{/* 开关只提供还原；其他字段同时提供清空和还原。 */}
							<>
								{field.type === 'switch' ? null : <Button
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
								/>}
								{(field.type === 'switch' || hasInitialValue(initialValues[field.name]) || field.defaultValue !== undefined) ? <Button
									type="text"
									size="small"
									title="还原"
									icon={<RollbackOutlined />}
									onClick={() => {
									const hasSavedValue = hasInitialValue(initialValues[field.name]);
									const restoreValue = field.defaultValue !== undefined ? field.defaultValue : initialValues[field.name];
									form.setFields([{ name: field.name, value: restoreValue, touched: false, errors: [] }]);
									setLiveValues((previous) => ({ ...previous, [field.name]: restoreValue }));
										if (hasSavedValue && field.defaultValue === undefined) changedFields.current.delete(field.name);
										else changedFields.current.add(field.name);
										setDirty(changedFields.current.size > 0);
									}}
								/> : null}
							</>
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
				{!formConfig?.passportLogin?.enabled && formConfig?.submitLabel ? <Button type="primary" htmlType="submit" loading={saving}>{formConfig.submitLabel}</Button> : null}
				{formConfig?.submitHint ? <Typography.Text type="secondary">{formConfig.submitHint}</Typography.Text> : null}
			</Space>
		</Form>
		{formConfig?.externalLogins?.length ? <>
			<Divider plain style={{ marginTop: 8, color: '#8c8c8c' }}>或使用以下方式登录</Divider>
			<Space size={28} wrap style={{ width: '100%', justifyContent: 'center' }}>
				{formConfig.externalLogins.map((item) => {
					const brand = externalLoginIcons[item.key];
					return <Typography.Link
						key={item.key}
						title={item.label}
						disabled={saving || Boolean(runningAction)}
						onClick={() => runAction(`provider:${item.key}`)}
						style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: 'inherit' }}
					>
						<span style={{ fontSize: 34, lineHeight: 1, color: brand?.color ?? '#8c8c8c' }}>{brand?.icon ?? <UserOutlined />}</span>
						<Typography.Text type="secondary" style={{ fontSize: 12 }}>{item.label}</Typography.Text>
					</Typography.Link>;
				})}
			</Space>
		</> : null}
	</>;
	return embedded ? <Spin spinning={loading}>{content}</Spin> : <Card title={title} loading={loading}>{content}</Card>;
}
