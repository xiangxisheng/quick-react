import type React from 'react';
import type { FilterValue } from 'antd/es/table/interface.js';
import type { TableProps, TablePaginationConfig } from 'antd';
import type { TableColumnsType } from 'antd';
import type { ResJSON, DataType, ResJsonTable } from '@/utils/common/api.js';
import type { ResJsonTableOption } from '@/utils/common/api.js';
import type { CommonApi, ResJsonTableColumn } from '@/utils/common/api.js';

import { useRef, useState, useEffect } from 'react';
import { Table, Button, Flex, Space, Tag, Select } from 'antd';
import { useNavigate } from 'react-router-dom';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useDrawer } from '@/utils/common/drawer.js';
import dayjs from 'dayjs';

// 定义TableCRUD的传参
type TableCrudType = {
	commonApi: CommonApi;
	resourcePath: string;
};


export default ({ commonApi, resourcePath }: TableCrudType) => {
	const initialData = (window as Window & {
		__INITIAL_DATA__?: { apiSuffix?: string };
	}).__INITIAL_DATA__;
	const apiPath = `/api${resourcePath}${initialData?.apiSuffix ?? ''}`;
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
		showSizeChanger: true,
	});
	const [filters, setFilters] = useState<Record<string, FilterValue | null>>({});
	const [dataSource, setDataSource] = useState<DataType[]>([]);
	const [tableColumns, setTableColumns] = useState<TableColumnsType<DataType>>();
	const [resJsonColumns, setResJsonColumns] = useState<ResJsonTableColumn[]>([]);
	const [resJsonTableOption, setResJsonTableOption] = useState<ResJsonTableOption>({ rowKey: 'key' });
	const [database, setDatabase] = useState('current');
	const [tableName, setTableName] = useState('');
	const [databaseOptions, setDatabaseOptions] = useState<{ value: string; text: string }[]>([]);
	const [tableOptions, setTableOptions] = useState<{ value: string; text: string }[]>([]);
	const selectedQuery = tableName ? `?table=${encodeURIComponent(tableName)}` : '';
	const selectedApiPath = `${apiPath}${selectedQuery}`;
	const cacheResJsonTable = useRef<ResJsonTable>({
		columns: [],
	});

	const apiDelete = async (ids: unknown[]) => {
		// 向后段API发送删除指令
		try {
			setLoading(true);
			await commonApi.apiFetch(selectedApiPath, { method: 'DELETE', body: JSON.stringify(ids) });
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
		if (!cacheResJsonTable.current.columns?.length) {
			alert('no cacheResJsonTable.columns');
			return;
		}
		const rowId = String(record[resJsonTableOption.rowKey] ?? '');
		if (!rowId) {
			console.error('编辑失败：记录缺少 rowKey', record);
			return;
		}
		const url = `${apiPath}/${encodeURIComponent(rowId)}${selectedQuery}`;
		let row: DataType;
		try {
			const res = await commonApi.apiFetch(url, {
				method: 'GET',
				headers: { 'Content-Type': 'application/json' },
			});
			if (!res.ok) {
				return;
			}
			row = await res.json() as DataType;
		} catch (ex) {
			console.error('加载编辑数据失败', ex);
			return;
		}
		const drawerForm1 = drawer.drawerForm({
			title: '编辑',
			columns: cacheResJsonTable.current.columns,
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
		drawerForm1.setRow(row);

	}

	const fetchData = async (): Promise<void> => {
		setLoading(true);
		try {
			const query: Record<string, string> = {
				pageNum: pagination.current?.toString() || '0',
				pageSize: pagination.pageSize?.toString() || '0',
			};
			if (database) query.database = database;
			if (tableName) query.table = tableName;
			const queryString = new URLSearchParams(query).toString();
			const response: Response = await commonApi.apiFetch(`${apiPath}?${queryString}`);
			const resJSON: ResJSON = await response.json();
			if (resJSON.table) {
				if (resJSON.table.databases) setDatabaseOptions(resJSON.table.databases);
				if (resJSON.table.tables) {
					setTableOptions(resJSON.table.tables);
					if (!tableName && resJSON.table.tables[0]) setTableName(resJSON.table.tables[0].value);
				}
				if (resJSON.table.option) {
					Object.assign(resJsonTableOption, resJSON.table.option);
					setResJsonTableOption((prev) => ({ ...prev, ...resJSON.table?.option }));
				}
				if (resJSON.table.columns) {
					cacheResJsonTable.current.columns = resJSON.table.columns;
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
								if (column.component === 'switch') {
									return <Tag color={value ? 'green' : 'default'}>{value ? '是' : '否'}</Tag>;
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
							{resJsonTableOption.editable !== false && <><a onClick={() => onOpenEdit(value, record, index)}>编辑</a>
							<a onClick={() => onDeleteOne(value, record, index)}>删除</a></>}
						</Space>),
					});
					setTableColumns(tableColumns);
				}
				if (resJSON.table.dataSource) {
					setDataSource(resJSON.table.dataSource);
				}
			}

			//setDrawerRow({ name: 'asdf' });
			setPagination((prev) => ({ ...prev, total: resJSON.table?.totalRecords, }));

		} catch (ex) {
			console.error(ex);
		} finally {
			setLoading(false);
		}

	}

	useEffect(() => {
		fetchData();
	}, [apiPath, database, tableName, filters, pagination.pageSize, pagination.current]);
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
				const res = await commonApi.apiFetch(selectedApiPath, {
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
		<Flex wrap gap="small" align="center">
			<span>SQLite 数据库</span>
			<Select style={{ minWidth: 190 }} value={database} options={databaseOptions.map((item) => ({ value: item.value, label: item.text }))} onChange={(value) => { setDatabase(value); setTableName(''); }} placeholder="选择数据库" />
			<span>数据表</span>
			<Select style={{ minWidth: 220 }} value={tableName || undefined} options={tableOptions.map((item) => ({ value: item.value, label: item.text }))} onChange={setTableName} placeholder="选择数据表" allowClear />
		</Flex>
		<Flex wrap gap="small">
			<Button type="primary" onClick={() => onAddNew(resJsonColumns)} icon={<PlusOutlined />} disabled={loading || resJsonTableOption.editable === false || !tableName}>新增</Button>
			<Button danger type="primary" disabled={selectedRowKeys.length === 0 || resJsonTableOption.editable === false} onClick={onDelete} icon={<DeleteOutlined />}>删除</Button>
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
