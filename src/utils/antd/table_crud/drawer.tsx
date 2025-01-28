import type { DataType, ResJsonTableColumn } from '@/utils/common/api';
import type { CommonApi } from '@/utils/common/api';
import { Button, Col, DatePicker, Drawer, Form, Input, Row, Select, Space } from 'antd';
import { InputNumber } from 'antd';
import { useEffect } from 'react';

// 定义TableCRUD的传参
type TableCrudType = {
	title: string;
	columns: ResJsonTableColumn[];
	row: DataType;
	open: boolean;
	onClose: () => void;
	commonApi: CommonApi;
	onFinish: (values: Record<string, string>) => Promise<void>;
	okText: string;
	cancelText: string;
};

function getFormItemComponent(item: ResJsonTableColumn) {
	switch (item.component) {
		case ('textbox'):
			return (
				<Input placeholder={item.placeholder} />
			);
		case ('url'):
			return (
				<Input
					style={{ width: '100%' }}
					addonBefore="http://"
					addonAfter=".com"
					placeholder={item.placeholder}
				/>
			);
		case ('select'):
			return (
				<Select placeholder={item.placeholder}>
					{item.options?.map((option) => (
						<Select.Option value={option.value}>{option.text}</Select.Option>
					))}
				</Select>
			);
		case ('textarea'):
			return (
				<Input.TextArea rows={4} placeholder={item.placeholder} />
			);
		case ('datepicker'):
			return (
				<DatePicker
					style={{ width: '100%' }}
					format={item.dayjsFormat}
					placeholder={item.placeholder}
					onChange={(_, dateString) => {
						console.log('onChange', item.dataIndex, dateString);
					}}
				/>
			);
		case ('datepicker_rangepicker'):
			return (
				<DatePicker.RangePicker
					style={{ width: '100%' }}
					getPopupContainer={(trigger) => trigger.parentElement!}
				/>
			);
		case ('inputnumber'):
			return (<InputNumber style={{ width: '100%' }} placeholder={item.placeholder} />);
	}
}

export default ({ commonApi, title, columns, row, open, onClose, onFinish, okText, cancelText }: TableCrudType) => {

	const [form] = Form.useForm();
	const handleSubmit = () => {
		form.submit();
	};

	useEffect(() => {
		if (open === false) {
			if (form.isFieldsTouched()) {
				form.resetFields();
			}
		}
	}, [open]);

	useEffect(() => {
		// 外部调用设置新的row值时，刷新新值
		form.setFieldsValue(row);
		form.resetFields();
	}, [row]);

	const _onClose = async () => {
		if (form.isFieldsTouched()) {
			// 当表单内容有被修改时弹出[确认提示]
			if (!await commonApi.modalConfirm([
				'内容修改尚未保存，仍要离开吗？'
			], {
				okText: '离开',
				cancelText: '留下',
			})) {
				// 代表点了[取消]
				return;
			}
		}
		onClose();
	};

	return (<>
		<Drawer
			title={title}
			width={720}
			onClose={_onClose}
			open={open}
			styles={{
				body: {
					paddingBottom: 80,
				},
			}}
			extra={
				<Space>
					<Button onClick={_onClose}>{cancelText}</Button>
					<Button onClick={handleSubmit} type="primary">
						{okText}
					</Button>
				</Space>
			}
		>
			<Form layout="vertical" form={form} onFinish={onFinish} initialValues={row}>
				<Row gutter={16}>
					{columns.map((item) => {
						if (!item.component) {
							return;
						}
						const component = getFormItemComponent(item);
						if (!component) {
							return;
						}
						return (
							<Col span={24}>
								<Form.Item
									name={item.dataIndex}
									label={item.title}
									rules={item.rules}
								>
									{component}
								</Form.Item>
							</Col>
						);
					})}
				</Row>
			</Form>
		</Drawer>
	</>);
};
