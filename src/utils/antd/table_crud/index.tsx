import type React from 'react';
import type { FilterValue } from 'antd/es/table/interface';
import type { TableProps, TablePaginationConfig } from 'antd';
import type { TableColumnsType } from 'antd';
import type { ResJSON, DataType, ResJsonTable } from '@/utils/common/api';
import type { ResJsonTableOption } from '@/utils/common/api';
import type { CommonApi, ResJsonTableColumn } from '@/utils/common/api';

import { useState, useEffect } from 'react';
import { Table, Button, Flex, Space, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useDrawer } from '@/utils/common/drawer';
import dayjs from 'dayjs';

// 定义TableCRUD的传参
type TableCrudType = {
	commonApi: CommonApi;
	api_url: string;
};


export default ({ commonApi, api_url }: TableCrudType) => {
	const [drawer, contextHolderDrawer] = useDrawer(commonApi);

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
	const [tableColumns, setTableColumns] = useState<TableColumnsType<DataType>>();
	const [resJsonColumns, setResJsonColumns] = useState<ResJsonTableColumn[]>([]);
	const [resJsonTableOption, setResJsonTableOption] = useState<ResJsonTableOption>({ rowKey: 'key' });
	const cacheResJsonTable: ResJsonTable = {
		columns: [],
	};

	const apiDelete = async (ids: unknown[]) => {
		// 向后段API发送删除指令
		try {
			setLoading(true);
			await commonApi.apiFetch(api_url, { method: 'DELETE', body: JSON.stringify(ids) });
			await fetchData();
		} catch (ex) {
			console.error(ex);
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
		if (!cacheResJsonTable.columns) {
			alert('no cacheResJsonTable.columns');
			return;
		}
		const drawerForm1 = drawer.drawerForm({
			title: '编辑',
			columns: cacheResJsonTable.columns,
		}, async (newRow) => {
			if (!newRow) {
				// 用户点了[取消]按钮
				return;
			}
			drawerForm1.setSubmitting‌(true);
			try {
				const res = await commonApi.apiFetch(url, {
					method: 'PUT', // 指定请求方法
					headers: {
						'Content-Type': 'application/json', // 指定请求头，表明是 JSON 数据
					},
					body: JSON.stringify(newRow), // 将数据转换为 JSON 字符串
				});
				if (!res.ok) {
					return;
				}
				drawer.drawerClose();
				await fetchData();
			} catch (ex) {
				console.error(ex);
			} finally {
				drawerForm1.setSubmitting‌(false);
			}
		});
		drawerForm1.setLoading(true);

		const rowId = record[resJsonTableOption.rowKey];
		const url = `${api_url}/${rowId}`;
		try {
			const res = await commonApi.apiFetch(url, {
				method: 'GET', // 指定请求方法
				headers: {
					'Content-Type': 'application/json', // 指定请求头，表明是 JSON 数据
				},
			});
			const row = await res.json();
			if (!res.ok) {
				return;
			}
			drawerForm1.setRow(row);

		} catch (ex) {
			console.error(ex);
		} finally {
			drawerForm1.setLoading(false);
		}

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
					cacheResJsonTable.columns = resJSON.table.columns;
					setResJsonColumns(resJSON.table.columns);
					const tableColumns: TableColumnsType<DataType> = [];
					for (const column of resJSON.table.columns) {
						tableColumns.push({
							...column,
							render: (value) => {
								if (column.dayjsFormat) {
									if (!value) {
										return <span style={{ color: '#CCCCCC' }}>(空)</span>;
									}
								}
								if (column.dataType === 'js_timestamp') {
									return dayjs(value).format(column.dayjsFormat);
								}
								if (column.options) {
									for (const option of column.options) {
										if (option.value !== value) {
											continue;
										}
										return <Tag color={option.color} key={option.value}>{option.text}</Tag>;
									}
								}
								return value;
							},
						});
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
					setTableColumns(tableColumns);
				}
				if (resJSON.table.dataSource) {
					setDataSource(resJSON.table.dataSource);
				}
			}

			//setDrawerRow({ name: 'asdf' });
			setPagination((prev) => ({ ...prev, total: 0 }));

		} catch (ex) {
			console.error(ex);
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

	const onAddNew = async (columns: ResJsonTableColumn[]) => {
		const drawerForm = drawer.drawerForm({
			title: '新增',
			columns,
		}, async (newRow) => {
			if (!newRow) {
				// 用户点了[取消]按钮
				return;
			}
			// 前端校验通过，开始向后端提交表单
			drawerForm.setSubmitting‌(true);
			try {
				const res = await commonApi.apiFetch(api_url, {
					method: 'POST', // 指定请求方法
					headers: {
						'Content-Type': 'application/json', // 指定请求头，表明是 JSON 数据
					},
					body: JSON.stringify(newRow), // 将数据转换为 JSON 字符串
				});
				if (!res.ok) {
					return;
				}
				//form.resetFields();
				drawer.drawerClose();
				await fetchData();
			} catch (ex) {
				console.error(ex);
			} finally {
				drawerForm.setSubmitting‌(false);
			}
		});

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
		{contextHolderDrawer}
		<Flex wrap gap="small">
			<Button type="primary" onClick={() => onAddNew(resJsonColumns)} icon={<PlusOutlined />} disabled={loading}>新增</Button>
			<Button danger type="primary" disabled={selectedRowKeys.length === 0} onClick={onDelete} icon={<DeleteOutlined />}>删除</Button>
		</Flex>
		<Table<DataType>
			rowSelection={rowSelection}
			pagination={pagination}
			onChange={onChange}
			columns={tableColumns}
			dataSource={dataSource}
			loading={loading}
			rowKey={resJsonTableOption?.rowKey}
			scroll={{ x: 'max-content' }}
		/>
	</Flex>);
};
