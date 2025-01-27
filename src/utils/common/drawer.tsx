import type { CommonApi, DataType, ResJsonTableColumn } from '@/utils/common/api';
import type { Dayjs } from 'dayjs';
import { useState, useRef } from 'react';
import DrawerForm from '@/utils/antd/table_crud/drawer';
import dayjs from 'dayjs';

export interface drawerType {
	drawerClose: () => void;
	drawerForm: (props: DrawerFuncProps, callback: (value?: DataType) => void) => Promise<DataType | undefined> | void;
}

export interface DrawerFuncProps {
	title: string,
	columns: ResJsonTableColumn[],
	row?: DataType,
}

export function useDrawer(commonApi: CommonApi): [drawerType, JSX.Element] {
	const [open, setOpen] = useState(false);
	const [columns, setColumns] = useState<ResJsonTableColumn[]>([]);
	const [row, setRow] = useState<DataType>({});
	const [title, setTitle] = useState<string>('');
	const resolveRef = useRef<(value?: DataType) => void>(); // 使用 useRef 持久化 resolve

	const drawer: drawerType = {
		drawerClose: () => {
			setOpen(false);
		},
		drawerForm: (props: DrawerFuncProps, callback?: (value?: DataType) => void): Promise<DataType | undefined> | void => {
			setTitle(props.title);
			setColumns(props.columns);
			if (props.row) {
				for (const column of props.columns) {
					if (column.dayjsFormat) {
						// 读入日期之前将字符串转换成dayjs格式
						props.row[column.dataIndex] = dayjs(props.row[column.dataIndex]?.toString(), column.dayjsFormat);
					}
				}
				setRow(props.row);
			}
			setOpen(true);
			if (callback) {
				resolveRef.current = callback;
				return;
			}
			return new Promise((_resolve, reject) => {
				resolveRef.current = _resolve;
			});
		}
	};
	const onFinish = async (values: Record<string, string | number | Date | Dayjs | null | undefined>) => {
		if (resolveRef.current) {
			for (const column of columns) {
				if (column.dayjsFormat) {
					// 返回日期之前将dayjs转换成字符串
					values[column.dataIndex] = dayjs(values[column.dataIndex]).format(column.dayjsFormat);
				}
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
		/>
	];
}
