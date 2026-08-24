import type React from 'react';
import type { FilterValue } from 'antd/es/table/interface.js';
import type { TableProps, TablePaginationConfig } from 'antd';
import type { TableColumnsType } from 'antd';
import type { ResJSON, DataType, ResJsonTable } from '@/utils/common/api.js';
import type { ResJsonTableOption } from '@/utils/common/api.js';
import type { CommonApi, ResJsonTableColumn } from '@/utils/common/api.js';
import type { TableAction, TableQueryField } from '@shared/types/table.mjs';

import { useRef, useState, useEffect } from 'react';
import { Table, Button, Flex, Input, Space, Tag, Select } from 'antd';
import { useNavigate } from 'react-router-dom';
import { PlusOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
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
	const [queryFields, setQueryFields] = useState<TableQueryField[]>([]);
	const [queryValues, setQueryValues] = useState<Record<string, string>>({});
	const [appliedQueryValues, setAppliedQueryValues] = useState<Record<string, string>>({});
	const selectedQuery = new URLSearchParams(appliedQueryValues).toString();
	const selectedQuerySuffix = selectedQuery ? `?${selectedQuery}` : '';
	const cacheResJsonTable = useRef<ResJsonTable>({
		columns: [],
	});

	const apiDelete = async (ids: unknown[]) => {
		// 向后段API发送删除指令
		try {
			setLoading(true);
			await commonApi.apiFetch(`${apiPath}${selectedQuerySuffix}`, { method: 'DELETE', body: JSON.stringify(ids) });
			await fetchData();
		} catch (ex) {
			console.error(ex);
		} finally {
			setLoading(false);
		}
	}

	const onDeleteOne = async (value: any, record: DataType, index: number, action?: TableAction): Promise<void> => {
		// 点击删除按钮时，弹出提示让用户确认删除操作
		const rowId = record[resJsonTableOption.rowKey];
		const aContentLine: string[] = [action?.confirm ?? `确定要删除 ${resJsonTableOption.rowKey} = ${rowId} 吗？`];
		if (!await commonApi.modalConfirm(aContentLine)) {
			return;
		}
		await apiDelete([rowId]);
	}

	const onOpenEdit = async (value: any, record: DataType, index: number, action: TableAction): Promise<void> => {
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
		const url = `${apiPath}/${encodeURIComponent(rowId)}${selectedQuerySuffix}`;
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
			title: action.label,
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
			Object.assign(query, appliedQueryValues);
			const queryString = new URLSearchParams(query).toString();
			const response: Response = await commonApi.apiFetch(`${apiPath}?${queryString}`);
			const resJSON: ResJSON = await response.json();
			if (resJSON.table) {
				if (resJSON.table.option) {
					Object.assign(resJsonTableOption, resJSON.table.option);
					setResJsonTableOption((prev) => ({ ...prev, ...resJSON.table?.option }));
					const fields = resJSON.table.option.queryFields;
					if (fields) {
						setQueryFields(fields);
						setQueryValues((previous) => Object.fromEntries(fields.map((field) => [
							field.dataIndex,
							previous[field.dataIndex] ?? field.defaultValue ?? '',
						])));
					}
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
						render: (value: any, record: DataType, index: number) => <Space>
							{(resJsonTableOption.rowActions ?? []).map((action) => rowActionHandlers[action.action]?.(action, value, record, index) ?? null)}
						</Space>,
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
	}, [apiPath, JSON.stringify(appliedQueryValues), filters, pagination.pageSize, pagination.current]);
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

	const onAddNew = async (columns: ResJsonTableColumn[], action: TableAction) => {
		const drawerForm = drawer.drawerForm({
			title: action.label,
			columns,
		}, async (newRow) => {
			if (!newRow) {
				// 用户点了[取消]按钮
				return;
			}
			// 前端校验通过，开始向后端提交表单
			drawerForm.setSubmitting‌(true);
			try {
				const res = await commonApi.apiFetch(`${apiPath}${selectedQuerySuffix}`, {
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

	const onDelete = async (action?: TableAction) => {
		if (!await commonApi.modalConfirm(
			[action?.confirm ?? `确定删除所选的 ${selectedRowKeys.length} 项吗？`]
		)) {
			return;
		}
		await apiDelete(selectedRowKeys);
	}

	const rowActionHandlers: Record<string, (action: TableAction, value: any, record: DataType, index: number) => React.ReactNode> = {
		edit: (action, value, record, index) => <a key={action.key} aria-disabled={action.disabled} onClick={() => !action.disabled && onOpenEdit(value, record, index, action)}>{action.label}</a>,
		delete: (action, value, record, index) => <a key={action.key} aria-disabled={action.disabled} onClick={() => !action.disabled && onDeleteOne(value, record, index, action)}>{action.label}</a>,
	};
	const toolbarActionHandlers: Record<string, (action: TableAction) => React.ReactNode> = {
		search: (action) => <Button key={action.key} onClick={() => { setAppliedQueryValues(queryValues); setPagination((prev) => ({ ...prev, current: 1 })); }} icon={<SearchOutlined />} disabled={loading || action.disabled}>{action.label}</Button>,
		create: (action) => <Button key={action.key} type="primary" onClick={() => onAddNew(resJsonColumns, action)} icon={<PlusOutlined />} disabled={loading || action.disabled}>{action.label}</Button>,
		delete: (action) => <Button key={action.key} danger type="primary" disabled={selectedRowKeys.length === 0 || action.disabled} onClick={() => onDelete(action)} icon={<DeleteOutlined />}>{action.label}</Button>,
	};

	return (<Flex vertical gap="small">
		{contextHolderDrawer}
		<Flex wrap gap="small" align="center">
			{queryFields.map((field) => (
				<Space key={field.dataIndex} size={4}>
					<span>{field.label}</span>
					{field.component === 'select'
						? <Select style={{ minWidth: 190 }} value={queryValues[field.dataIndex] || undefined} options={field.options?.map((item) => ({ value: item.value, label: item.text }))} onChange={(value) => setQueryValues((previous) => ({ ...previous, [field.dataIndex]: value }))} placeholder={field.placeholder} allowClear />
						: <Input value={queryValues[field.dataIndex] ?? ''} onChange={(event) => setQueryValues((previous) => ({ ...previous, [field.dataIndex]: event.target.value }))} placeholder={field.placeholder} />}
				</Space>
			))}
		</Flex>
		<Flex wrap gap="small">
			{(resJsonTableOption.toolbarActions ?? []).map((action) => toolbarActionHandlers[action.action]?.(action) ?? null)}
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
