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
	readOnlyWhen?: { field: string; values?: string[]; notValues?: string[] };
	rules?: { required?: boolean; message?: string }[];
};

export type FormPageConfig = {
	description?: string;
	submitLabel?: string;
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
