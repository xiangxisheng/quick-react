import type React from 'react';
import type { AliyunResponse, AliyunInstance } from '@/utils/api/aliyuncs';
import type { TableProps } from 'antd';
import type { FetchApiParams, FetchApiResult } from '@/utils/antd/xtable';
import { Space } from 'antd';
import { XTable } from '@/utils/antd/xtable';
import { AliyunApi } from '@/utils/api/aliyuncs';
import { getColumnSearchProps } from '@/utils/antd/getColumnSearchProps';

interface DataType extends AliyunInstance { };

const App: React.FC = () => {

	// 代码分类：表列定义
	const columns: TableProps<DataType>['columns'] = [
		{
			title: '创建时间',
			dataIndex: 'CreationTime',
			key: 'CreationTime',
			ellipsis: false,
			sorter: (a, b) => a.CreationTime.localeCompare(b.CreationTime),
		},
		{
			title: '实例名称',
			dataIndex: 'InstanceName',
			key: 'InstanceName',
			ellipsis: false,
			sorter: (a, b) => a.InstanceName.localeCompare(b.InstanceName),
			render: (text) => <>{text}</>,
			...getColumnSearchProps<DataType>('InstanceName'),
		},
		{
			title: '实例类型',
			dataIndex: 'InstanceType',
			key: 'InstanceType',
			ellipsis: false,
			sorter: (a, b) => a.InstanceType.localeCompare(b.InstanceType),
			render: (_, record) => <>{record.InstanceType}({record.Cpu}核{record.Memory / 1024}G)</>,
		},
		{
			title: 'EipAddress',
			dataIndex: 'EipAddress',
			key: 'EipAddress',
			ellipsis: false,
			sorter: (a, b) => a.EipAddress.IpAddress.localeCompare(b.EipAddress.IpAddress),
			render: (_, record) => <>{record.EipAddress.IpAddress}({record.EipAddress.Bandwidth}M)</>,
		},
		{
			title: '系统类型',
			dataIndex: 'OSType',
			key: 'OSType',
			ellipsis: false,
			sorter: (a, b) => a.OSType.localeCompare(b.OSType),
		},
		{
			title: '实例状态',
			dataIndex: 'Status',
			key: 'Status',
			ellipsis: false,
			sorter: (a, b) => a.Status.localeCompare(b.Status),
			filters: [
				{ text: '创建中', value: 'Pending' },
				{ text: '运行中', value: 'Running' },
				{ text: '启动中', value: 'Starting' },
				{ text: '停止中', value: 'Stopping' },
				{ text: '已停止', value: 'Stopped' },
			],
			filterMultiple: false,
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

	// 代码分类：API数据加载
	async function fetchApi(params: FetchApiParams): Promise<FetchApiResult<DataType>> {
		/*
		 * 阿里云ECS接口文档
		 * https://help.aliyun.com/zh/ecs/developer-reference/api-ecs-2014-05-26-describeinstances
		 */
		const requestParams: Record<string, string | number> = {
			AccessKeyId: localStorage.getItem('AccessKeyId') ?? '',
			RegionId: 'cn-hangzhou',
			Action: 'DescribeInstances',
			PageSize: params.pagination.pageSize ?? 10,
			PageNumber: params.pagination.current ?? 1,
		};
		for (const key in params.filters) {
			const value = params.filters[key];
			if (value) {
				if (key === 'InstanceName') {
					requestParams[key] = '%' + value[0] + '%';
				} else {
					requestParams[key] = String(value[0]);
				}
			}
		}
		const aliRes: AliyunResponse = await AliyunApi(requestParams, localStorage.getItem('AccessKeySecret') ?? '');
		console.log('aliRes', aliRes);
		//console.log(aliRes.Instances.Instance);
		const dataSource: DataType[] = [];
		for (const instance of aliRes.Instances.Instance) {
			dataSource.push(instance);
		}
		return ({ dataSource, total: aliRes.TotalCount });
	}

	return (<XTable<DataType>
		columns={columns}
		fetchApi={fetchApi}
	/>);
};

export default App;
