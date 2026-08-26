import type { TableColumn } from './types/table.mjs';

export type TableFormMode = 'create' | 'edit';

export const resolveTableFormColumns = (columns: TableColumn[], mode: TableFormMode): TableColumn[] => columns.flatMap((definition) => {
	const { form, ...column } = definition;
	const override = form?.[mode];
	if (override === false) return [];
	return [{ ...column, ...override }];
});
