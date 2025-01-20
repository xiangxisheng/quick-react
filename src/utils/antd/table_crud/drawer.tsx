import type { DataType, ResJsonTableColumn } from '@/utils/common/api';
import type { CommonApi } from '@/utils/common/api';
import { Button, Col, DatePicker, Drawer, Form, Input, Row, Select, Space } from 'antd';
import { Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';

// 定义TableCRUD的传参
type TableCrudType = {
    api_url: string;
    title: string;
    columns: ResJsonTableColumn[];
    row: DataType;
    open: boolean;
    onClose: () => void;
    commonApi: CommonApi;
    fetchData: () => Promise<void>;
};

function getFormItemComponent(item: ResJsonTableColumn) {
    switch (item.form) {
        case ('input'):
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
        case ('datepicker_rangepicker'):
            return (
                <DatePicker.RangePicker
                    style={{ width: '100%' }}
                    getPopupContainer={(trigger) => trigger.parentElement!}
                />
            );

    }
}

export default ({ commonApi, api_url, title, columns, row, open, onClose, fetchData }: TableCrudType) => {
    const [modal, contextHolder] = Modal.useModal();

    const [form] = Form.useForm();
    const handleSubmit = () => {
        form.submit();
    };

    const onFinish = async (values: Record<string, string>) => {
        // 前端校验通过，开始向后端提交表单
        try {
            const res = await commonApi.apiFetch(api_url, {
                method: 'POST', // 指定请求方法
                headers: {
                    'Content-Type': 'application/json', // 指定请求头，表明是 JSON 数据
                },
                body: JSON.stringify(values), // 将数据转换为 JSON 字符串
            });
            if (!res.ok) {
                return;
            }
            form.resetFields();
            onClose();
            await fetchData();
        } catch (ex) {

        } finally {

        }
    }

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
        form.resetFields();
        onClose();
    };

    return (<>
        {contextHolder}
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
                    <Button onClick={_onClose}>取消</Button>
                    <Button onClick={handleSubmit} type="primary">
                        确定
                    </Button>
                </Space>
            }
        >
            <Form layout="vertical" form={form} onFinish={onFinish} initialValues={row}>
                <Row gutter={16}>
                    {columns.map((item) => {
                        if (!item.form) {
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
