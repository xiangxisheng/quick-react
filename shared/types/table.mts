export type TableData = Record<string, unknown>;
export type TableColumnComponent = 'textbox' | 'url' | 'textarea' | 'select' | 'switch' | 'datepicker' | 'datepicker_rangepicker' | 'inputnumber' | 'upload';
export type TableDataType = 'js_timestamp' | 'int' | 'float' | 'string' | 'datetime';
export type TableColumnRule = { required: boolean; message: string };
export type TableAction = {
	key: string;
	label: string;
	action: string;
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
	checkedValue?: string | boolean;
	uncheckedValue?: string | boolean;
	dataType?: TableDataType;
	dayjsFormat?: string;
};
export type TableActions = { toolbar?: TableAction[]; query?: TableAction[]; row?: TableAction[] };
export type TableOption = { rowKey: string; actions?: TableActions; queryFields?: TableQueryField[] };
export type TableSelectOption = { value: string; text: string; color?: string; dataTypes?: string[] };
export type TableResponse = {
	option?: TableOption;
	columns?: TableColumn[];
	dataSource?: TableData[];
	totalRecords?: number;
};
export type TableRow = TableData & { key: string };
