export const changedFieldsKey = '__changedFields' as const;

export type ChangedFieldsPayload = {
	[changedFieldsKey]?: string[];
};
