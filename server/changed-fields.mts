import { changedFieldsKey } from '@shared/types/changed-fields.mjs';

type ObjectRecord = Record<string, unknown>;

const readObject = (value: unknown): ObjectRecord => (
	value && typeof value === 'object' && !Array.isArray(value)
		? value as ObjectRecord
		: {}
);

export const getChangedFields = (body: unknown, allowedFields: readonly string[]) => {
	const source = readObject(body);
	const requested = Array.isArray(source[changedFieldsKey])
		? source[changedFieldsKey].filter((field): field is string => typeof field === 'string')
		: allowedFields.filter((field) => field in source);
	return new Set(requested.filter((field) => allowedFields.includes(field)));
};

export const mergeChangedFields = <T extends ObjectRecord>(
	current: T,
	body: unknown,
	allowedFields: readonly (keyof T & string)[],
) => {
	const source = readObject(body);
	const changedFields = getChangedFields(source, allowedFields);
	const next = { ...current };
	for (const field of allowedFields) {
		if (changedFields.has(field) && field in source) next[field] = source[field] as T[typeof field];
	}
	return next;
};
