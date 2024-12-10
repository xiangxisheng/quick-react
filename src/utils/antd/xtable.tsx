import type React from 'react';
import type { FilterValue } from 'antd/es/table/interface';
import type { TableProps, TablePaginationConfig } from 'antd';
import { useState, useEffect } from 'react';
import { Table } from 'antd';
import { useNavigate } from 'react-router-dom';

export interface FetchApiParams {
	pagination: TablePaginationConfig;
	filters: Record<string, FilterValue | null>;
};

export interface FetchApiResult<T> {
	dataSource: T[],
	total: number
};

// 定义XTable的泛型传参
type XTableType<T> = {
	columns: TableProps<T>['columns'];
	fetchApi: (params: FetchApiParams) => Promise<FetchApiResult<T>>;
};

export const XTable = <T,>({ columns, fetchApi }: XTableType<T>) => {

	// 代码分类：批量操作
	const rowSelection: TableProps<T>['rowSelection'] = (() => {
		const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
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
	const [dataSource, setDataSource] = useState<T[]>([]);
	async function fetchData() {
		setLoading(true);
		try {
			const { dataSource, total } = await fetchApi({ pagination, filters });
			setDataSource(dataSource);
			setPagination((prev) => ({ ...prev, total }));
		} catch (ex) {
		} finally {
			setLoading(false);
		}
	}
	useEffect(() => {
		fetchData();
	}, [filters, pagination.pageSize, pagination.current]);
	const onChange: TableProps<T>['onChange'] = (_pagination: TablePaginationConfig, _filters, _sorter, _extra) => {
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

	return (
		<Table<T>
			rowSelection={rowSelection}
			pagination={pagination}
			onChange={onChange}
			columns={columns}
			dataSource={dataSource}
			loading={loading}
			rowKey="InstanceId"
		/>
	);
};
