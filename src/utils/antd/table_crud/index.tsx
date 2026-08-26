import type React from 'react';
import type { FilterValue } from 'antd/es/table/interface.js';
import type { TableProps, TablePaginationConfig } from 'antd';
import type { TableColumnsType } from 'antd';
import type { ResJSON, DataType, ResJsonTable } from '@/utils/common/api.js';
import type { ResJsonTableOption } from '@/utils/common/api.js';
import type { CommonApi, ResJsonTableColumn } from '@/utils/common/api.js';
import type { TableAction, TableQueryField } from '@shared/types/table.mjs';
import { resolveTableFormColumns } from '@shared/table-form.mjs';

import { useRef, useState, useEffect } from 'react';
import { Table, Button, Flex, Input, Space, Tag, Select, Progress, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { PlusOutlined, DeleteOutlined, SearchOutlined, UploadOutlined, DownloadOutlined } from '@ant-design/icons';
import { useDrawer } from '@/utils/common/drawer.js';
import dayjs from 'dayjs';

// 定义TableCRUD的传参
type TableCrudType = {
	commonApi: CommonApi;
	resourcePath: string;
};

type UploadState = {
	fileName: string;
	loaded: number;
	total: number;
	percent: number;
	phase: 'signing' | 'uploading' | 'success' | 'error' | 'cancelled';
	message?: string;
};

const formatBytes = (bytes: number): string => {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
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
	const [uploadState, setUploadState] = useState<UploadState>();
	const uploadAbortController = useRef<AbortController | undefined>(undefined);
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
	const [queryActions, setQueryActions] = useState<TableAction[]>([]);
	const [queryValues, setQueryValues] = useState<Record<string, string>>({});
	const [appliedQueryValues, setAppliedQueryValues] = useState<Record<string, string>>({});
	const [searchRequestKey, setSearchRequestKey] = useState(0);
	const initializedQueryDefaultsFor = useRef('');
	const cursorsByPage = useRef<Record<number, string | undefined>>({ 1: undefined });
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
			columns: resolveTableFormColumns(cacheResJsonTable.current.columns, 'edit'),
			optionsPath: apiPath,
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
			const currentPage = pagination.current ?? 1;
			const currentCursor = cursorsByPage.current[currentPage];
			if (currentCursor) query.cursor = currentCursor;
			Object.assign(query, appliedQueryValues);
			const queryString = new URLSearchParams(query).toString();
			const response: Response = await commonApi.apiFetch(`${apiPath}?${queryString}`);
			const resJSON: ResJSON = await response.json();
			if (resJSON.table) {
				if (resJSON.table.option) {
					Object.assign(resJsonTableOption, resJSON.table.option);
					setResJsonTableOption((prev) => ({ ...prev, ...resJSON.table?.option }));
					const fields = resJSON.table.option.queryFields;
					setQueryActions(resJSON.table.option.actions?.query ?? []);
					if (fields) {
						setQueryFields(fields);
						setQueryValues((previous) => Object.fromEntries(fields.map((field) => [
							field.dataIndex,
							previous[field.dataIndex] ?? field.defaultValue ?? '',
						])));
						if (initializedQueryDefaultsFor.current !== apiPath) {
							initializedQueryDefaultsFor.current = apiPath;
							const defaults = Object.fromEntries(fields
								.filter((field) => field.defaultValue !== undefined && field.defaultValue !== '')
								.map((field) => [field.dataIndex, field.defaultValue as string]));
							if (Object.keys(defaults).length) setAppliedQueryValues(defaults);
						}
					} else {
						setQueryFields([]);
						setQueryActions([]);
						setQueryValues({});
						setAppliedQueryValues({});
					}
				}
				if (resJSON.table.columns) {
					cacheResJsonTable.current.columns = resJSON.table.columns;
					setResJsonColumns(resJSON.table.columns);
					const tableColumns: TableColumnsType<DataType> = [];
					for (const column of resJSON.table.columns) {
						if (column.hideInTable) continue;
						const { tableDisplay, tableDisplayTextField, ...tableColumn } = column;
						tableColumns.push({
							...tableColumn,
							render: (value, record) => {
								if (column.dayjsFormat) {
									if (!value) {
										return <span style={{ color: '#CCCCCC' }}>(空)</span>;
									}
								}
								if (column.dataType === 'js_timestamp') {
									return dayjs(value).format(column.dayjsFormat);
								}
								if (tableDisplay === 'reference') {
									const display = tableDisplayTextField ? record[tableDisplayTextField] : value;
									return <span>{String(display ?? value ?? '')}<Typography.Text type="secondary"> (id:{String(value ?? '')})</Typography.Text></span>;
								}
								if (column.options) {
									const values = Array.isArray(value) ? value : [value];
									const tags = column.options.filter((option) => values.includes(option.value))
										.map((option) => <Tag color={option.color} key={option.value}>{option.text}</Tag>);
									if (tags.length) return <Space size={[0, 4]} wrap>{tags}</Space>;
								}
								if (column.component === 'switch') {
									const checked = column.checkedValue === undefined ? Boolean(value) : value === column.checkedValue;
									const label = column.options?.find((option) => option.value === value)?.text ?? (checked ? '是' : '否');
									return <Tag color={checked ? 'green' : 'default'}>{label}</Tag>;
								}
								if (tableDisplay === 'multiline') {
									return <Typography.Paragraph
										style={{ width: 320, marginBottom: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
										ellipsis={{ rows: 3, expandable: 'collapsible', symbol: '展开' }}
									>{String(value ?? '')}</Typography.Paragraph>;
								}
								return value;
							},
						});
					}
					tableColumns.push({
						title: '操作',
						key: 'operation',
						fixed: 'right',
						width: 160,
						render: (value: any, record: DataType, index: number) => <Space wrap size={[8, 4]}>
							{(resJsonTableOption.actions?.row ?? []).map((action) => rowActionHandlers[action.key]?.(action, value, record, index)
								?? <a key={action.key} aria-disabled={action.disabled} onClick={() => action.form ? onRowFormAction(action, record) : onSimpleRowAction(action, record)}>{action.label}</a>)}
						</Space>,
					});
					setTableColumns(tableColumns);
				}
				if (resJSON.table.dataSource) {
					setDataSource(resJSON.table.dataSource);
				}
				if (resJSON.table.hasMore !== undefined) {
					if (resJSON.table.nextCursor) cursorsByPage.current[currentPage + 1] = resJSON.table.nextCursor;
					else delete cursorsByPage.current[currentPage + 1];
					for (const page of Object.keys(cursorsByPage.current).map(Number)) {
						if (page > currentPage + 1) delete cursorsByPage.current[page];
					}
				}
			}

			//setDrawerRow({ name: 'asdf' });
			setPagination((prev) => {
				const current = prev.current ?? 1;
				const pageSize = prev.pageSize ?? 10;
				const currentCount = resJSON.table?.dataSource?.length ?? 0;
				const cursorTotal = resJSON.table?.hasMore === undefined
					? undefined
					: (current - 1) * pageSize + currentCount + (resJSON.table.hasMore ? 1 : 0);
				return { ...prev, total: cursorTotal ?? resJSON.table?.totalRecords };
			});

		} catch (ex) {
			console.error(ex);
		} finally {
			setLoading(false);
		}

	}

	useEffect(() => {
		fetchData();
	}, [apiPath, JSON.stringify(appliedQueryValues), searchRequestKey, filters, pagination.pageSize, pagination.current]);
	useEffect(() => () => uploadAbortController.current?.abort(), []);
	const onChange: TableProps<DataType>['onChange'] = (_pagination: TablePaginationConfig, _filters, _sorter, _extra) => {
		// console.log('onChange-params', { _pagination, _filters, _sorter, _extra });
		setPagination((prev) => {
			if (prev.pageSize !== _pagination.pageSize) {
				cursorsByPage.current = { 1: undefined };
				return { ...prev, pageSize: _pagination.pageSize, current: 1 };
			}
			return { ...prev, pageSize: _pagination.pageSize, current: _pagination.current };
		});
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

	const onAddNew = async (action: TableAction) => {
		const drawerForm = drawer.drawerForm({
			title: action.label,
			columns: resolveTableFormColumns(resJsonColumns, 'create'),
			optionsPath: apiPath,
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

	const onTest = async (action: TableAction, record: DataType) => {
		const rowId = String(record[resJsonTableOption.rowKey] ?? '');
		if (!rowId) return;
		const url = `${apiPath}/${encodeURIComponent(rowId)}?action=test`;
		if (!action.form) {
			await commonApi.apiFetch(url, { method: 'POST' });
			return;
		}
		const drawerForm = drawer.drawerForm({
			title: action.label,
			columns: action.form.columns,
			optionsPath: `${apiPath}/${encodeURIComponent(rowId)}`,
		}, async (values) => {
			if (!values) return;
			drawerForm.setSubmitting‌(true);
			try {
				await commonApi.apiFetch(url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(values),
				});
				drawer.drawerClose();
			} catch (error) {
				console.error(error);
			} finally {
				drawerForm.setSubmitting‌(false);
			}
		});
	};

	const onToolbarFormAction = (action: TableAction) => {
		if (!action.form) return;
		const drawerForm = drawer.drawerForm({ title: action.label, columns: action.form.columns, optionsPath: apiPath }, async (values) => {
			if (!values) return;
			drawerForm.setSubmitting‌(true);
			try {
				await commonApi.apiFetch(`${apiPath}?action=${encodeURIComponent(action.key)}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(values),
				});
				drawer.drawerClose();
				await fetchData();
			} catch (error) {
				console.error(error);
			} finally {
				drawerForm.setSubmitting‌(false);
			}
		});
	};
	const onSimpleRowAction = async (action: TableAction, record: DataType) => {
		const rowId = String(record[resJsonTableOption.rowKey] ?? '');
		if (!rowId || action.disabled) return;
		if (action.confirm && !await commonApi.modalConfirm([action.confirm])) return;
		await commonApi.apiFetch(`${apiPath}/${encodeURIComponent(rowId)}?action=${encodeURIComponent(action.key)}`, { method: 'POST' });
		await fetchData();
	};
	const onRowFormAction = async (action: TableAction, record: DataType) => {
		if (!action.form || action.disabled) return;
		const rowId = String(record[resJsonTableOption.rowKey] ?? '');
		if (!rowId) return;
		if (action.confirm && !await commonApi.modalConfirm([action.confirm])) return;
		const drawerForm = drawer.drawerForm({
			title: action.label,
			columns: action.form.columns,
			optionsPath: `${apiPath}/${encodeURIComponent(rowId)}`,
		}, async (values) => {
			if (!values) return;
			drawerForm.setSubmitting‌(true);
			try {
				const response = await commonApi.apiFetch(`${apiPath}/${encodeURIComponent(rowId)}?action=${encodeURIComponent(action.key)}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(values),
				});
				if (!response.ok) return;
				drawer.drawerClose();
				await fetchData();
			} catch (error) {
				console.error(error);
			} finally {
				drawerForm.setSubmitting‌(false);
			}
		});
	};

	const rowActionHandlers: Record<string, (action: TableAction, value: any, record: DataType, index: number) => React.ReactNode> = {
		edit: (action, value, record, index) => <a key={action.key} aria-disabled={action.disabled} onClick={() => !action.disabled && onOpenEdit(value, record, index, action)}>{action.label}</a>,
		delete: (action, value, record, index) => <a key={action.key} aria-disabled={action.disabled} onClick={() => !action.disabled && onDeleteOne(value, record, index, action)}>{action.label}</a>,
		test: (action, _value, record) => <a key={action.key} aria-disabled={action.disabled} onClick={() => !action.disabled && onTest(action, record)}>{action.label}</a>,
		download: (action, _value, record) => <a key={action.key} aria-disabled={action.disabled} onClick={async () => {
			if (action.disabled) return;
			const key = String(record[resJsonTableOption.rowKey] ?? '');
			const query = new URLSearchParams(appliedQueryValues);
			query.set('key', key);
			const response = await commonApi.apiFetch(`${apiPath}?${query}`, { method: 'PUT' });
			const result = await response.json() as { downloadUrl?: string };
			if (result.downloadUrl) window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
		}}>{action.label}</a>,
	};
	const toolbarActionHandlers: Record<string, (action: TableAction) => React.ReactNode> = {
		create: (action) => <Button key={action.key} type="primary" onClick={() => onAddNew(action)} icon={<PlusOutlined />} disabled={loading || action.disabled}>{action.label}</Button>,
		delete: (action) => <Button key={action.key} danger type="primary" disabled={selectedRowKeys.length === 0 || action.disabled} onClick={() => onDelete(action)} icon={<DeleteOutlined />}>{action.label}</Button>,
		upload: (action) => <Button key={action.key} type="primary" icon={<UploadOutlined />} disabled={loading || action.disabled || uploadState?.phase === 'signing' || uploadState?.phase === 'uploading'} onClick={() => {
			const input = document.createElement('input');
			input.type = 'file';
			input.onchange = async () => {
				const file = input.files?.[0];
				if (!file) return;
				const abortController = new AbortController();
				uploadAbortController.current = abortController;
				setUploadState({ fileName: file.name, loaded: 0, total: file.size, percent: 0, phase: 'signing' });
				try {
					setLoading(true);
					const key = file.name;
					const response = await commonApi.apiFetch(`${apiPath}${selectedQuerySuffix}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, size: file.size }) });
					const result = await response.json() as { uploadUrl?: string };
					if (!result.uploadUrl) throw new Error('上传地址为空');
					setUploadState((previous) => previous && { ...previous, phase: 'uploading' });
					const uploadBody = file.slice(0, file.size, '');
					await commonApi.uploadFile(result.uploadUrl, uploadBody, {
						signal: abortController.signal,
						onProgress: (loaded, total) => setUploadState((previous) => previous && {
							...previous,
							loaded,
							total,
							percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
							phase: 'uploading',
						}),
					});
					setUploadState({ fileName: file.name, loaded: file.size, total: file.size, percent: 100, phase: 'success', message: '上传完成' });
					await fetchData();
				} catch (error) {
					const cancelled = error instanceof DOMException && error.name === 'AbortError';
					setUploadState((previous) => previous && { ...previous, phase: cancelled ? 'cancelled' : 'error', message: cancelled ? '上传已取消' : (error instanceof Error ? error.message : '上传失败') });
					console.error(error);
				} finally {
					if (uploadAbortController.current === abortController) uploadAbortController.current = undefined;
					setLoading(false);
				}
			};
			input.click();
		}}>{action.label}</Button>,
	};
	const queryActionHandlers: Record<string, (action: TableAction) => React.ReactNode> = {
		search: (action) => <Button key={action.key} onClick={() => { cursorsByPage.current = { 1: undefined }; setAppliedQueryValues(queryValues); setSearchRequestKey((previous) => previous + 1); setPagination((prev) => ({ ...prev, current: 1 })); }} icon={<SearchOutlined />} disabled={loading || action.disabled}>{action.label}</Button>,
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
			{queryActions.map((action) => queryActionHandlers[action.key]?.(action) ?? null)}
		</Flex>
		<Flex wrap gap="small">
			{(resJsonTableOption.actions?.toolbar ?? []).map((action) => toolbarActionHandlers[action.key]?.(action)
				?? (action.form ? <Button key={action.key} disabled={loading || action.disabled} onClick={() => onToolbarFormAction(action)}>{action.label}</Button> : null))}
		</Flex>
		{uploadState && <Flex gap="middle" align="center" style={{ padding: '12px 16px', border: '1px solid #f0f0f0', borderRadius: 8 }}>
			<Flex vertical style={{ flex: 1, minWidth: 0 }}>
				<Typography.Text ellipsis title={uploadState.fileName}>{uploadState.fileName}</Typography.Text>
				<Progress
					percent={uploadState.percent}
					status={uploadState.phase === 'success' ? 'success' : uploadState.phase === 'error' || uploadState.phase === 'cancelled' ? 'exception' : 'active'}
				/>
				<Typography.Text type="secondary">
					{uploadState.phase === 'signing' ? '正在创建上传签名…' : uploadState.message ?? `正在上传 ${formatBytes(uploadState.loaded)} / ${formatBytes(uploadState.total)}`}
				</Typography.Text>
			</Flex>
			{(uploadState.phase === 'signing' || uploadState.phase === 'uploading') && <Button onClick={() => uploadAbortController.current?.abort()}>取消上传</Button>}
		</Flex>}
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
