import type { DataType, ResJsonTableColumn } from '@/utils/common/api.js';
import type { CommonApi } from '@/utils/common/api.js';
import type { UploadProps } from 'antd';
import type { TableSelectOption } from '@shared/types/table.mjs';
import { changedFieldsKey, type ChangedFieldsPayload } from '@shared/types/changed-fields.mjs';

import { ClearOutlined, InboxOutlined, RollbackOutlined } from '@ant-design/icons';
import { Button, Col, DatePicker, Drawer, Form, Input, Row, Select, Space, Switch } from 'antd';
import { Upload } from 'antd';
import { InputNumber } from 'antd';
import { useEffect, useRef, useState } from 'react';

// 定义TableCRUD的传参
type TableCrudType = {
	title: string;
	columns: ResJsonTableColumn[];
	optionsPath?: string;
	row: DataType;
	open: boolean;
	onClose: () => void;
	commonApi: CommonApi;
	onFinish: (values: Record<string, unknown>) => Promise<void>;
	okText: string;
	cancelText: string;
	loading: boolean;
	submitting‌: boolean;
};

function getFullFileExtension(filename: string): string {
	const index = filename.indexOf('.');
	return index !== -1 ? filename.slice(index) : '';
}

function getFormItemComponent(item: ResJsonTableColumn, row: DataType, parentValue?: unknown, remoteOptions?: TableSelectOption[], optionsLoading?: boolean, onOptionChange?: (value: unknown) => void) {
	switch (item.component) {
		case ('textbox'):
			return (
				item.inputType === 'password'
					? <Input.Password placeholder={item.placeholder} />
					: <Input placeholder={item.placeholder} />
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
				<Select
					showSearch
					allowClear
					mode={item.allowCustomValue ? 'tags' : item.multiple ? 'multiple' : undefined}
					maxCount={!item.multiple && item.allowCustomValue ? 1 : undefined}
					loading={optionsLoading}
					placeholder={item.placeholder}
					optionFilterProp="label"
					filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
					onChange={onOptionChange}
					options={(remoteOptions ?? item.options)
						?.filter((option) => !item.dependsOn || option.parentValue === parentValue)
						.map((option) => ({ value: option.value, label: option.text }))}
				/>
			);
		case ('switch'):
			return <Switch checkedChildren="启用" unCheckedChildren="禁用" />;
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
				listType: 'picture-card',
				showUploadList: {
					extra: ({ size = 0 }) => (
						<span style={{ color: '#cccccc' }}>({(size / 1024 / 1024).toFixed(2)}MB)</span>
					),
					showPreviewIcon: true,
					showRemoveIcon: true,
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
						支持单个或多个上传。
					</p>
				</Upload.Dragger>
			);



	}
}

export default ({
	commonApi,
	title,
	columns,
	optionsPath,
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
	const formValues = Form.useWatch([], form);
	const changedFields = useRef(new Set<string>());
	const [remoteOptions, setRemoteOptions] = useState<Record<string, TableSelectOption[]>>({});
	const [loadingOptions, setLoadingOptions] = useState<Record<string, boolean>>({});
	const remoteRequestKey = JSON.stringify(columns.filter((item) => item.remoteOptions).map((item) => [
		item.dataIndex,
		item.remoteOptions?.dependencies.map((field) => formValues?.[field] ?? null),
	]));
	const handleSubmit = () => {
		form.submit();
	};
	const applyOptionFieldValues = (column: ResJsonTableColumn, value: unknown, options?: TableSelectOption[]) => {
		const selectedValue = Array.isArray(value) ? value[0] : value;
		const option = options?.find((item) => item.value === selectedValue);
		if (!option?.fieldValues) return;
		form.setFieldsValue(option.fieldValues);
		for (const field of Object.keys(option.fieldValues)) changedFields.current.add(field);
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
		changedFields.current.clear();
		form.resetFields();
		form.setFieldsValue(row);
	}, [row]);

	useEffect(() => {
		if (!open || !optionsPath) return;
		const controller = new AbortController();
		const timer = window.setTimeout(async () => {
			for (const column of columns.filter((item) => item.remoteOptions)) {
				const request = column.remoteOptions!;
				const dependencies = Object.fromEntries(request.dependencies.map((field) => [field, form.getFieldValue(field)]));
				if (Object.values(dependencies).some((value) => value === undefined || value === null || value === '')) {
					setRemoteOptions((previous) => ({ ...previous, [column.dataIndex]: [] }));
					continue;
				}
				setRemoteOptions((previous) => ({ ...previous, [column.dataIndex]: [] }));
				setLoadingOptions((previous) => ({ ...previous, [column.dataIndex]: true }));
				try {
					const query = new URLSearchParams({ action: request.action, field: column.dataIndex });
					for (const [field, value] of Object.entries(dependencies)) query.set(field, String(value));
					const response = await commonApi.apiFetch(`${optionsPath}?${query}`, { signal: controller.signal });
					if (!response.ok) continue;
					const result = await response.json() as { options?: TableSelectOption[] };
					const options = result.options ?? [];
					setRemoteOptions((previous) => ({ ...previous, [column.dataIndex]: options }));
					if (options.length === 1 && !form.getFieldValue(column.dataIndex)) {
						const value = column.allowCustomValue ? [options[0].value] : options[0].value;
						form.setFieldValue(column.dataIndex, value);
						changedFields.current.add(column.dataIndex);
						applyOptionFieldValues(column, value, options);
					}
				} catch (error) {
					if (!(error instanceof DOMException && error.name === 'AbortError')) console.error('加载远程选项失败', error);
				} finally {
					setLoadingOptions((previous) => ({ ...previous, [column.dataIndex]: false }));
				}
			}
		}, 300);
		return () => { window.clearTimeout(timer); controller.abort(); };
	}, [open, optionsPath, remoteRequestKey]);

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
				onValuesChange={(values) => {
					for (const field of Object.keys(values)) changedFields.current.add(field);
					for (const changedField of Object.keys(values)) {
						for (const column of columns.filter((item) => item.remoteOptions?.dependencies.includes(changedField))) {
							for (const field of [column.dataIndex, ...(column.remoteOptions?.clearFields ?? [])]) {
								if (form.getFieldValue(field) !== undefined) {
									form.setFieldValue(field, undefined);
									changedFields.current.add(field);
								}
							}
						}
						for (const column of columns.filter((item) => item.dependsOn === changedField)) {
							if (column.parentValues && !column.parentValues.includes(values[changedField] as string | number | boolean)) {
								if (form.getFieldValue(column.dataIndex) !== undefined) {
									form.setFieldValue(column.dataIndex, undefined);
									changedFields.current.add(column.dataIndex);
								}
								continue;
							}
							const selectedValue = form.getFieldValue(column.dataIndex);
							const selectedOption = column.options?.find((option) => option.value === selectedValue);
							if (selectedValue && selectedOption?.parentValue !== values[changedField]) {
								form.setFieldValue(column.dataIndex, undefined);
								changedFields.current.add(column.dataIndex);
							}
						}
					}
				}}
				onFinish={(values) => {
					for (const column of columns) {
						if (!column.multiple && column.allowCustomValue && Array.isArray(values[column.dataIndex])) values[column.dataIndex] = values[column.dataIndex][0];
					}
					return onFinish({ ...values, [changedFieldsKey]: [...changedFields.current] } satisfies ChangedFieldsPayload & Record<string, unknown>);
				}}
				initialValues={row}
				disabled={submitting‌}
			>
				<Row gutter={16}>
					{columns.map((item) => {
						if (!item.component) {
							return;
						}
						if (item.dependsOn && item.parentValues && !item.parentValues.includes(formValues?.[item.dependsOn] as string | number | boolean)) return;
						const options = remoteOptions[item.dataIndex] ?? item.options;
						const component = getFormItemComponent(item, row, item.dependsOn ? formValues?.[item.dependsOn] : undefined, remoteOptions[item.dataIndex], loadingOptions[item.dataIndex],
							(value) => applyOptionFieldValues(item, value, options));
						if (!component) {
							return;
						}
						return (
							<Col key={item.dataIndex} span={24}>
								<Form.Item
									name={item.dataIndex}
									valuePropName={item.component === 'switch' ? 'checked' : undefined}
									getValueProps={item.component === 'switch' ? (value) => ({ checked: value === (item.checkedValue ?? true) }) : undefined}
									getValueFromEvent={item.component === 'switch' ? (checked: boolean) => checked ? (item.checkedValue ?? true) : (item.uncheckedValue ?? false) : undefined}
									label={(
										<Space size={2}>
											<span>{item.title}</span>
											<Button
												type="text"
												size="small"
												title="清空"
												icon={<ClearOutlined />}
												onClick={() => {
													form.setFields([{ name: item.dataIndex, value: null, touched: true }]);
													changedFields.current.add(item.dataIndex);
												}}
											/>
											<Button
												type="text"
												size="small"
												title="还原"
												icon={<RollbackOutlined />}
												onClick={() => {
													form.setFields([{ name: item.dataIndex, value: row[item.dataIndex], touched: false, errors: [] }]);
													changedFields.current.delete(item.dataIndex);
												}}
											/>
										</Space>
									)}
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
