export type FieldLinkOption = { value: string };
export type FieldReadOnlyWhen = {
	field: string;
	values?: string[];
	notValues?: string[];
	optionValues?: boolean;
};

export const isFieldReadOnly = (rule: FieldReadOnlyWhen | undefined, dependencyValue: unknown, sourceOptions: FieldLinkOption[] = []) => {
	if (!rule) return false;
	const value = String(dependencyValue ?? '');
	if (!value) return false;
	if (rule.optionValues) return value !== '__custom__' && sourceOptions.some((option) => option.value === value);
	if (rule.values) return rule.values.includes(value);
	if (rule.notValues) return !rule.notValues.includes(value);
	return false;
};
