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
	redirectTo?: string;
	/** 在弹窗里完成的流程：优先关闭窗口，关不掉时才回落到 redirectTo。 */
	closeWindow?: boolean;
};
import type { ApiFeedback } from './api-response.mjs';
import type { FieldReadOnlyWhen } from '../field-linkage.mjs';
