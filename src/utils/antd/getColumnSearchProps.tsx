import type { FilterDropdownProps } from 'antd/es/table/interface';
import type { InputRef, TableColumnType } from 'antd';
import { useRef } from 'react';
import { SearchOutlined } from '@ant-design/icons';
import { Button, Space, Input } from 'antd';

// 第1部分代码：搜索框
export const getColumnSearchProps = <T,>(dataIndex: keyof T): TableColumnType<T> => {
	const searchInput = useRef<InputRef>(null);
	const handleSearch = (
		selectedKeys: string[],
		confirm: FilterDropdownProps['confirm'],
		dataIndex: keyof T,
	) => {
		confirm();
	};
	const handleReset = (
		clearFilters: () => void,
		confirm: FilterDropdownProps['confirm'],
		dataIndex: keyof T,
	) => {
		clearFilters();
		confirm();
	};
	return {
		filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters, close }) => (
			<div style={{ padding: 8 }} onKeyDown={(e) => e.stopPropagation()}>
				<Input
					ref={searchInput}
					placeholder={`Search ${String(dataIndex)}`}
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
