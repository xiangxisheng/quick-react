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

/** 第三方登录入口：前端按 key 渲染图标链接，点击后走 `?action=provider:<key>`。 */
export type FormPageExternalLogin = { key: string; label: string };

export type FormPageConfig = {
	/** 需要跳转到 Accounts 完成登录的页面。跳转必须由用户点击触发，不提供自动跳转。 */
	passportLogin?: { enabled: boolean; mode?: 'popup' | 'redirect' };
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
	redirectTo?: string;
};
import type { ApiFeedback } from './api-response.mjs';
import type { FieldReadOnlyWhen } from '../field-linkage.mjs';
