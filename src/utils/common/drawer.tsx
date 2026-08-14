import type React from 'react';
import type { CommonApi, DataType, ResJsonTableColumn } from '@/utils/common/api.js';
import type { Dayjs } from 'dayjs';
import { useState, useRef } from 'react';
import DrawerForm from '@/utils/antd/table_crud/drawer.js';
import dayjs from 'dayjs';

interface testType {
	setRow: (value: DataType) => void;
	setLoading: (value: boolean) => void;
	setSubmitting‌: (value: boolean) => void;
}

export interface drawerType {
	drawerClose: () => void;
	drawerForm: (props: DrawerFuncProps, callback: (value?: DataType) => void) => testType;
}

export interface DrawerFuncProps {
	title: string,
	columns: ResJsonTableColumn[],
}

export function useDrawer(commonApi: CommonApi): [drawerType, React.JSX.Element] {
	const [open, setOpen] = useState(false);
	const [columns, setColumns] = useState<ResJsonTableColumn[]>([]);
	const [row, setRow] = useState<DataType>({});
	const [title, setTitle] = useState<string>('');
	const resolveRef = useRef<((value?: DataType) => void) | undefined>(undefined); // 使用 useRef 持久化 resolve
	const [loading, setLoading] = useState<boolean>(false);
	const [submitting‌, setSubmitting‌] = useState<boolean>(false);

	const drawer: drawerType = {
		drawerClose: () => {
			setOpen(false);
		},
		drawerForm: (props: DrawerFuncProps, callback?: (value?: DataType) => void): testType => {
			setTitle(props.title);
			setColumns(props.columns);
			setRow({});
			setOpen(true);
			if (callback) {
				resolveRef.current = callback;
			}
			return {
				setRow: (_row: DataType) => {
					// 外部调用设置新的row值时，刷新新值
					const normalizedRow = { ..._row };
					for (const column of props.columns) {
						if (column.component !== 'datepicker' || !normalizedRow[column.dataIndex]) {
							continue;
						}
						// DatePicker 只能接收 Dayjs，后端日期字符串需要先转换。
						normalizedRow[column.dataIndex] = dayjs(normalizedRow[column.dataIndex]?.toString());
					}
					setRow(normalizedRow);
				},
				setLoading,
				setSubmitting‌,
			};
		}
	};
	const onFinish = async (values: Record<string, string | number | Date | Dayjs | null | undefined>) => {
		if (resolveRef.current) {
			for (const column of columns) {
				if (column.component !== 'datepicker' || !values[column.dataIndex]) {
					continue;
				}
				// 返回日期之前将 Dayjs 转换成后端可存储的字符串。
				const date = dayjs(values[column.dataIndex]);
				values[column.dataIndex] = column.dayjsFormat
					? date.format(column.dayjsFormat)
					: date.toISOString();
			}
			resolveRef.current(values);
		}
	};
	const onClose = () => {
		setOpen(false);
		if (resolveRef.current) {
			resolveRef.current();
		}
	};
	return [
		drawer,
		<DrawerForm
			commonApi={commonApi}
			title={title}
			columns={columns}
			row={row}
			open={open}
			onFinish={onFinish}
			onClose={onClose}
			okText='确定'
			cancelText='取消'
			loading={loading}
			submitting‌={submitting‌}
		/>
	];
}
