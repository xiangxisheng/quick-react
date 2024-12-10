import React, { useEffect, useState, useRef } from 'react';
import { SearchOutlined } from '@ant-design/icons';
import { Button, Space, Input, InputRef } from 'antd';
import { Table, TableProps, TablePaginationConfig, TableColumnType } from 'antd';
import type { FilterDropdownProps, FilterValue, SorterResult, TableCurrentDataSource } from 'antd/es/table/interface';
import { useNavigate } from 'react-router-dom';
import { AliyunApi } from '@/utils/api/aliyuncs';

interface EipAddress {
	AllocationId: string;
	Bandwidth: number;
	IpAddress: string;
}
interface VpcAttributes {
	PrivateIpAddress: {
		IpAddress: string;
	};
	VSwitchId: string;
	VpcId: string;
}
interface DataType {
	CreationTime: string;
	InstanceId: string;
	InstanceName: string;
	InstanceType: string;
	Cpu: number;
	Memory: number;
	EipAddress: EipAddress;
	StartTime: string;
	VpcAttributes: VpcAttributes;
	ZoneId: string;
	OSType: string
	Status: string;
}
type DataIndex = keyof DataType;
interface AliyunResponse {
	Instances: {
		Instance: DataType[],
	};
	PageNumber: number;
	PageSize: number;
	TotalCount: number;
}

type TableRowSelection<T extends object = object> = TableProps<T>['rowSelection'];

const App: React.FC = () => {

	// 第1部分代码：搜索框
	const getColumnSearchProps = (dataIndex: DataIndex): TableColumnType<DataType> => {
		const searchInput = useRef<InputRef>(null);
		const handleSearch = (
			selectedKeys: string[],
			confirm: FilterDropdownProps['confirm'],
			dataIndex: DataIndex,
		) => {
			confirm();
		};
		const handleReset = (
			clearFilters: () => void,
			confirm: FilterDropdownProps['confirm'],
			dataIndex: DataIndex,
		) => {
			clearFilters();
			confirm();
		};
		return {
			filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters, close }) => (
				<div style={{ padding: 8 }} onKeyDown={(e) => e.stopPropagation()}>
					<Input
						ref={searchInput}
						placeholder={`Search ${dataIndex}`}
						value={selectedKeys[0]}
						onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
						onPressEnter={() => handleSearch(selectedKeys as string[], confirm, dataIndex)}
						style={{ marginBottom: 8, display: 'block' }}
					/>
					<Space>
						<Button
							type="primary"
							onClick={() => handleSearch(selectedKeys as string[], confirm, dataIndex)}
							icon={<SearchOutlined />}
							size="small"
							style={{ width: 90 }}
						>
							Search
						</Button>
						<Button
							onClick={() => clearFilters && handleReset(clearFilters, confirm, dataIndex)}
							size="small"
							style={{ width: 90 }}
						>
							Reset
						</Button>
						<Button
							size="small"
							onClick={() => {
								close();
							}}
						>
							close
						</Button>
					</Space>
				</div>
			),
			filterIcon: (filtered: boolean) => (
				<SearchOutlined style={{ color: filtered ? '#1677ff' : undefined }} />
			),
			filterDropdownProps: {
				onOpenChange(open) {
					if (open) {
						setTimeout(() => searchInput.current?.select(), 100);
					}
				},
			},
		}
	};

	// 第2部分代码：表列
	const columns: TableProps<DataType>['columns'] = [
		{
			title: '创建时间',
			dataIndex: 'CreationTime',
			key: 'CreationTime',
		},
		{
			title: '实例名称',
			dataIndex: 'InstanceName',
			key: 'InstanceName',
			render: (text) => <>{text}</>,
			...getColumnSearchProps('InstanceName'),
		},
		{
			title: '实例类型',
			dataIndex: 'InstanceType',
			key: 'InstanceType',
			render: (_, record) => <>{record.InstanceType}({record.Cpu}核{record.Memory / 1024}G)</>,
		},
		{
			title: 'EipAddress',
			dataIndex: 'EipAddress',
			key: 'EipAddress',
			render: (_, record) => <>{record.EipAddress.IpAddress}({record.EipAddress.Bandwidth}M)</>,
		},
		{
			title: '系统类型',
			dataIndex: 'OSType',
			key: 'OSType',
		},
		{
			title: '实例状态',
			dataIndex: 'Status',
			key: 'Status',
		},
		{
			title: 'Action',
			key: 'action',
			render: (_, record) => (
				<Space size="middle">
					<button>查看</button>
				</Space>
			),
		},
	];

	// 第3部分代码：API数据加载
	const [loading, setLoading] = useState(false);
	const [pagination, setPagination] = useState<TablePaginationConfig>({
		current: 1,
		pageSize: 10,
	});
	const [dataSource, setDataSource] = useState<DataType[]>([]);
	const onChange = (() => {
		interface FetchDataParams {
			pagination: TablePaginationConfig;
			filters: Record<string, FilterValue | null>;
			sorter: SorterResult<DataType> | SorterResult<DataType>[];
		}
		async function fetchData(params: FetchDataParams) {
			setLoading(true);
			/*
			 * 阿里云ECS接口文档
			 * https://help.aliyun.com/zh/ecs/developer-reference/api-ecs-2014-05-26-describeinstances
			 */
			const requestParams: Record<string, any> = {
				AccessKeyId: localStorage.getItem('AccessKeyId'),
				RegionId: 'cn-hangzhou',
				Action: 'DescribeInstances',
				PageSize: params.pagination.pageSize,
				PageNumber: params.pagination.current,
			};
			for (const key in params.filters) {
				const value = params.filters[key];
				if (value) {
					requestParams[key] = '%' + value[0] + '%';
				}
			}
			setPagination((prev) => ({ ...prev, pageSize: params.pagination.pageSize, current: params.pagination.current }));
			try {
				const aliRes: AliyunResponse = await AliyunApi(requestParams, localStorage.getItem('AccessKeySecret') ?? '');
				//console.log(aliRes.Instances.Instance);
				const dataSource: DataType[] = [];
				for (const instance of aliRes.Instances.Instance) {
					dataSource.push(instance);
				}
				setDataSource(dataSource);
				setPagination((prev) => ({ ...prev, total: aliRes.TotalCount }));
			} catch (ex) {
			} finally {
				setLoading(false);
			}
		}
		useEffect(() => {
			fetchData({ pagination, filters: {}, sorter: [] });
		}, []);
		const onChange: TableProps<DataType>['onChange'] = (pagination: TablePaginationConfig, filters, sorter, extra) => {
			//console.log('onChange-params', { pagination, filters, sorter, extra });
			fetchData({ pagination, filters, sorter });
		};
		return onChange;
	})();

	// 第4部分代码：批量操作
	const rowSelection: TableRowSelection<DataType> = (() => {
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

	// 第5部分代码：导航
	const navigate = useNavigate();

	return (
		<>
			<button onClick={() => navigate('/api/console/aliyun')}>aliyun</button>
			<button onClick={() => navigate('/api/console/mail')}>test</button>
			<Table<DataType>
				rowSelection={rowSelection}
				pagination={pagination} onChange={onChange}
				columns={columns}
				dataSource={dataSource}
				loading={loading}
				rowKey="InstanceId"
			/>
		</>
	);
}

export default App;
