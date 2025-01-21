import type { CommonApi, DataType, ResJsonTableColumn } from '@/utils/common/api';
import { useState, useRef } from 'react';
import DrawerForm from '@/utils/antd/table_crud/drawer';

export interface drawerType {
	drawerClose: () => void;
	drawerForm: (props: DrawerFuncProps) => Promise<DataType | undefined>;
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
		drawerForm: (props: DrawerFuncProps): Promise<DataType | undefined> => {
			setTitle(props.title);
			setColumns(props.columns);
			setRow(props.row ?? {});
			setOpen(true);
			return new Promise((_resolve, reject) => {
				resolveRef.current = _resolve;
			});
		}
	};
	const onFinish = async (values: Record<string, string>) => {
		if (resolveRef.current) {
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
