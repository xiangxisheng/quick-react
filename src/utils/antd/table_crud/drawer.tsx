import type { DataType, ResJsonTableColumn } from '@/utils/common/api';
import type { CommonApi } from '@/utils/common/api';
import type { UploadProps } from 'antd';

import { InboxOutlined } from '@ant-design/icons';
import { Button, Col, DatePicker, Drawer, Form, Input, Row, Select, Space } from 'antd';
import { Upload } from 'antd';
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
	loading: boolean;
	submitting‌: boolean;
};

function getFullFileExtension(filename: string): string {
	const index = filename.indexOf('.');
	return index !== -1 ? filename.slice(index) : '';
}

function getFormItemComponent(item: ResJsonTableColumn, row: DataType) {
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
		case ('upload'):
			interface File {
				uid: string;
				name: string;
				size: number,
				type: string,
				url: string,
				response: {
					file_sha1: string;
				}
			}
			interface FileVal {
				file: File;
				fileList: File[];
			}
			console.log('row', row);
			const props: UploadProps = {
				name: 'file',
				multiple: true,
				maxCount: 10,
				action: '/api/upload',
				onChange(info) {
					console.log('info.event:', info.event, 'info.file:', info.file);
				},
				onDrop(e) {
					console.log('Dropped files', e.dataTransfer.files);
				},
			};
			const fileVal = row[item.dataIndex] as FileVal;
			if (fileVal && fileVal.file) {
				props.defaultFileList = [];
				for (const item of fileVal.fileList) {
					item.url = `/api/data/${item.response.file_sha1}${getFullFileExtension(item.name)}`;
					props.defaultFileList.push(item);
				}
			}
			return (
				<Upload.Dragger {...props}>
					<p className="ant-upload-drag-icon">
						<InboxOutlined />
					</p>
					<p className="ant-upload-text">拖动文件到此区域上传</p>
					<p className="ant-upload-hint">
						仅支持单个上传，最新上传的文件代替当前文件。
					</p>
					{0 ? <span onClick={(e) => e.stopPropagation()}>
						{fileVal && fileVal.file && fileVal.file.response ? <>
							查看已保存文件：
							{
								fileVal.fileList.map((item) => {
									return <div>
										<span>
											<a href={`/panel/data/rows/download/${item.response.file_sha1}`}>{item.name}</a>
											&nbsp;
											<a href={'#'}>删</a>
										</span>
									</div>
								})
							}
						</> : null}
					</span> : null}
				</Upload.Dragger>
			);



	}
}

export default ({
	commonApi,
	title,
	columns,
	row,
	open,
	onClose,
	onFinish,
	okText,
	cancelText,
	loading,
	submitting‌,
}: TableCrudType) => {

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
					<Button
						loading={submitting‌}
						disabled={loading}
						onClick={handleSubmit}
						type="primary"
					>
						{okText}
					</Button>
				</Space>
			}
			loading={loading}
		>
			<Form
				layout="vertical"
				form={form}
				onFinish={onFinish}
				initialValues={row}
				disabled={submitting‌}
			>
				<Row gutter={16}>
					{columns.map((item) => {
						if (!item.component) {
							return;
						}
						const component = getFormItemComponent(item, row);
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
