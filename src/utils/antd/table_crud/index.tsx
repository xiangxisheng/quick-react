import type React from 'react';
import type { FilterValue } from 'antd/es/table/interface';
import type { TableProps, TablePaginationConfig } from 'antd';
import type { TableColumnsType } from 'antd';
import { useState, useEffect } from 'react';
import { Table, Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import { PlusOutlined } from '@ant-design/icons';
import Drawer from './drawer';

interface DataType extends Record<string, string | number> { }

// 定义TableCRUD的传参
type TableCrudType = {
	api_url: string;
};


export default ({ api_url }: TableCrudType) => {

	interface ResponseJSON {
		columns: ResJsonTableColumn[];
		dataSource: DataType[];
	}

	// 代码分类：批量操作
	const rowSelection: TableProps<DataType>['rowSelection'] = (() => {
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
	const [dataSource, setDataSource] = useState<DataType[]>([]);
	const [columns, setColumns] = useState<TableColumnsType<DataType>>();
	const [resJsonColumns, setResJsonColumns] = useState<ResJsonTableColumn[]>([]);
	const [drawerRow, setDrawerRow] = useState<DataType>({});
	const [drawerTitle, setDrawerTitle] = useState<string>('');
	async function fetchData() {
		setLoading(true);
		try {
			const response: Response = await fetch(api_url);
			const resJSON: ResponseJSON = await response.json();
			setResJsonColumns(resJSON.columns);
			const tableColumns: TableColumnsType<DataType> = [];
			for (const column of resJSON.columns) {
				tableColumns.push(column);
			}
			setColumns(tableColumns);
			setDataSource(resJSON.dataSource);
			setDrawerRow({ name: 'asdf' });
			setPagination((prev) => ({ ...prev, total: 0 }));
		} catch (ex) {
			if (ex) {
				alert(ex.toString());
			}
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

	return (<>
		<Drawer
			title={drawerTitle}
			api_url={api_url}
			columns={resJsonColumns}
			row={drawerRow}
			open={open}
			onClose={() => setOpen(false)}
		/>
		<Button type="primary" onClick={onAddNew} icon={<PlusOutlined />}>
			新增
		</Button>
		<Table<DataType>
			rowSelection={rowSelection}
			pagination={pagination}
			onChange={onChange}
			columns={columns}
			dataSource={dataSource}
			loading={loading}
			rowKey="InstanceId"
		/>
	</>);
};
