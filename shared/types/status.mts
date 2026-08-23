import type { TableSelectOption } from './table.mjs';

export const statusValues = {
	enabled: 'enabled',
	disabled: 'disabled',
} as const;

export const enabledDisabledOptions = [
	{ value: statusValues.enabled, text: '启用', color: 'green' },
	{ value: statusValues.disabled, text: '禁用', color: 'red' },
] satisfies TableSelectOption[];
