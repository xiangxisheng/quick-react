import type React from 'react';
import type { FilterValue } from 'antd/es/table/interface';
import type { TableProps, TablePaginationConfig } from 'antd';
import type { TableColumnsType } from 'antd';
import type { ResJSON, DataType } from '@/utils/common/api';
import type { ResJsonTableColumn, ResJsonTableOption } from '@/utils/common/api';
import type { CommonApi } from '@/utils/common/api';

import { useState, useEffect } from 'react';
import { Table, Button, Flex, Space } from 'antd';
import { useNavigate } from 'react-router-dom';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import Drawer from './drawer';

// 定义TableCRUD的传参
type TableCrudType = {
	commonApi: CommonApi;
	api_url: string;
};


export default ({ commonApi, api_url }: TableCrudType) => {

	const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
	// 代码分类：批量操作
	const rowSelection: TableProps<DataType>['rowSelection'] = (() => {
		const onSelectChange = (newSelectedRowKeys: React.Key[]) => {
			console.log('selectedRowKeys changed: ', newSelectedRowKeys);
			setSelectedRowKeys(newSelectedRowKeys);
		};
		return {
			selectedRowKeys,
			onChange: onSelectChange,
			selections: [
				Table.SELECTION_ALL,
				Table.SELECTION_INVERT,
				Table.SELECTION_NONE,
			],
		};
	})();

	// 代码分类：API数据加载
	const [loading, setLoading] = useState(false);
	const [pagination, setPagination] = useState<TablePaginationConfig>({
		current: 1,
		pageSize: 10,
	});
	const [filters, setFilters] = useState<Record<string, FilterValue | null>>({});
	const [dataSource, setDataSource] = useState<DataType[]>([]);
	const [columns, setColumns] = useState<TableColumnsType<DataType>>();
	const [resJsonColumns, setResJsonColumns] = useState<ResJsonTableColumn[]>([]);
	const [resJsonTableOption, setResJsonTableOption] = useState<ResJsonTableOption>({ rowKey: 'key' });
	const [drawerRow, setDrawerRow] = useState<DataType>({});
	const [drawerTitle, setDrawerTitle] = useState<string>('');

	const apiDelete = async (ids: unknown[]) => {
		// 向后段API发送删除指令
		try {
			setLoading(true);
			await commonApi.apiFetch(api_url, { method: 'DELETE', body: JSON.stringify(ids) });
			await fetchData();
		} catch (ex) {
		} finally {
			setLoading(false);
		}
	}

	const onDeleteOne = async (value: any, record: DataType, index: number): Promise<void> => {
		// 点击删除按钮时，弹出提示让用户确认删除操作
		const rowId = record[resJsonTableOption.rowKey];
		const aContentLine: string[] = [`确定要删除 ${resJsonTableOption.rowKey} = ${rowId} 吗？`];
		if (!await commonApi.modalConfirm(aContentLine)) {
			return;
		}
		await apiDelete([rowId]);
	}

	const onOpenEdit = async (value: any, record: DataType, index: number): Promise<void> => {
		// 打开编辑框，获取单条数据
		const rowId = record[resJsonTableOption.rowKey];
		alert(rowId);
	}

	const fetchData = async (): Promise<void> => {
		setLoading(true);
		try {
			const response: Response = await commonApi.apiFetch(api_url);
			const resJSON: ResJSON = await response.json();
			if (resJSON.table) {
				if (resJSON.table.option) {
					Object.assign(resJsonTableOption, resJSON.table.option);
					setResJsonTableOption((prev) => ({ ...prev, ...resJSON.table?.option }));
				}
				if (resJSON.table.columns) {
					setResJsonColumns(resJSON.table.columns);
					const tableColumns: TableColumnsType<DataType> = [];
					for (const column of resJSON.table.columns) {
						tableColumns.push(column);
					}
					tableColumns.push({
						title: '操作',
						key: 'operation',
						fixed: 'right',
						width: 100,
						render: (value: any, record: DataType, index: number) => (<Space>
							<a onClick={() => onOpenEdit(value, record, index)}>编辑</a>
							<a onClick={() => onDeleteOne(value, record, index)}>删除</a>
						</Space>),
					});
					setColumns(tableColumns);
				}
				if (resJSON.table.dataSource) {
					setDataSource(resJSON.table.dataSource);
				}
			}

			//setDrawerRow({ name: 'asdf' });
			setPagination((prev) => ({ ...prev, total: 0 }));

		} catch (ex) {
		} finally {
			setLoading(false);
		}

	}

	useEffect(() => {
		fetchData();
	}, [filters, pagination.pageSize, pagination.current]);
	const onChange: TableProps<DataType>['onChange'] = (_pagination: TablePaginationConfig, _filters, _sorter, _extra) => {
		// console.log('onChange-params', { _pagination, _filters, _sorter, _extra });
		setPagination((prev) => ({ ...prev, pageSize: _pagination.pageSize, current: _pagination.current }));
		for (const k in _filters) {
			const v = filters[k] ?? null;
			if (JSON.stringify(_filters[k]) !== JSON.stringify(v)) {
				setFilters((prev) => ({ ...prev, ..._filters }));
				break;
			}
		}
	};

	// 代码分类：导航
	const navigate = useNavigate();

	const [open, setOpen] = useState(false);

	const onAddNew = () => {
		setDrawerTitle('新增');
		setOpen(true)
	};

	const onDelete = async () => {
		if (!await commonApi.modalConfirm(
			[`确定删除所选的 ${selectedRowKeys.length} 项吗？`]
		)) {
			return;
		}
		await apiDelete(selectedRowKeys);
	}

	return (<Flex vertical gap="small">
		<Drawer
			title={drawerTitle}
			commonApi={commonApi}
			api_url={api_url}
			columns={resJsonColumns}
			row={drawerRow}
			open={open}
			onClose={() => setOpen(false)}
			fetchData={fetchData}
		/>
		<Flex wrap gap="small">
			<Button type="primary" onClick={onAddNew} icon={<PlusOutlined />}>新增</Button>
			<Button danger type="primary" disabled={selectedRowKeys.length === 0} onClick={onDelete} icon={<DeleteOutlined />}>删除</Button>
		</Flex>
		<Table<DataType>
			rowSelection={rowSelection}
			pagination={pagination}
			onChange={onChange}
			columns={columns}
			dataSource={dataSource}
			loading={loading}
			rowKey={resJsonTableOption?.rowKey}
			scroll={{ x: 'max-content' }}
		/>
	</Flex>);
};
