export type TableData = Record<string, unknown>;
export type TableColumnComponent = 'textbox' | 'url' | 'textarea' | 'select' | 'switch' | 'datepicker' | 'datepicker_rangepicker' | 'inputnumber' | 'upload';
export type TableDataType = 'js_timestamp' | 'int' | 'float' | 'string' | 'datetime';
export type TableColumnRule = { required: boolean; message: string };
export type TableColumnRemoteOptions = { action: string; dependencies: string[]; clearFields?: string[] };
export type TableAction = {
	key: string;
	label: string;
	disabled?: boolean;
	confirm?: string;
};
export type TableQueryField = {
	dataIndex: string;
	label: string;
	component: 'textbox' | 'select';
	placeholder?: string;
	defaultValue?: string;
	options?: TableSelectOption[];
};
export type TableColumn = {
	dataIndex: string;
	title: string;
	component?: TableColumnComponent;
	inputType?: 'text' | 'password';
	rules?: TableColumnRule[];
	ellipsis?: boolean;
	placeholder?: string;
	options?: TableSelectOption[];
	dependsOn?: string;
	parentValues?: Array<string | number | boolean>;
	hideInTable?: boolean;
	multiple?: boolean;
	allowCustomValue?: boolean;
	remoteOptions?: TableColumnRemoteOptions;
	checkedValue?: string | boolean;
	uncheckedValue?: string | boolean;
	dataType?: TableDataType;
	dayjsFormat?: string;
};
export type TableActions = { toolbar?: TableAction[]; query?: TableAction[]; row?: TableAction[] };
export type TableOption = { rowKey: string; actions?: TableActions; queryFields?: TableQueryField[] };
export type TableSelectOption = {
	value: string;
	text: string;
	color?: string;
	dataTypes?: string[];
	parentValue?: string;
	fieldValues?: Record<string, string | number | boolean>;
};
export type TableResponse = {
	option?: TableOption;
	columns?: TableColumn[];
	dataSource?: TableData[];
	totalRecords?: number;
	nextCursor?: string;
	hasMore?: boolean;
};
export type TableRow = TableData & { key: string };
