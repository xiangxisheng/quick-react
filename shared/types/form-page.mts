export type FormPageFieldType = 'text' | 'password' | 'switch' | 'select' | 'hidden';

export type FormPageField = {
	name: string;
	label: string;
	type?: FormPageFieldType;
	extra?: string;
	placeholder?: string;
	maxLength?: number;
	checkedChildren?: string;
	unCheckedChildren?: string;
	options?: Array<{ value: string; text: string; fieldValues?: Record<string, unknown> }>;
	readOnlyWhen?: FieldReadOnlyWhen;
	rules?: { required?: boolean; message?: string }[];
};

/**
 * 第三方登录入口：前端按 key 渲染图标链接，点击后走 `?action=provider:<key>`。
 * recommended 的入口排在最前并标注 hint，用于优先引导到体验更好的登录方式。
 */
export type FormPageExternalLogin = { key: string; label: string; recommended?: boolean; hint?: string };

export type FormPageConfig = {
	/** 需要前往 Accounts 完成登录的页面：只在用户点击后弹出登录窗口，本页既不自动跳转也不整页跳走。 */
	passportLogin?: { enabled: boolean };
	description?: string;
	submitLabel?: string;
	actions?: Array<{ key: string; label: string }>;
	externalLogins?: FormPageExternalLogin[];
	confirmOnUnchangedSubmit?: string;
	submitHint?: string;
	initialValues: Record<string, unknown>;
	fields: FormPageField[];
};

export type FormPageResponse<T = Record<string, unknown>> = {
	currentValues?: T;
	formPage?: FormPageConfig;
	feedback?: ApiFeedback;
	next?: ApiNextAction;
	redirectTo?: string;
	/** 在弹窗里完成的流程：优先关闭窗口，关不掉时才回落到 redirectTo。 */
	closeWindow?: boolean;
	/** 在当前页面打开外部授权弹窗，表单本身保持打开。 */
	openWindow?: boolean;
};
import type { ApiFeedback, ApiNextAction } from './api-response.mjs';
import type { FieldReadOnlyWhen } from '../field-linkage.mjs';
