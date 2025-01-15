import { Button, Col, DatePicker, Drawer, Form, Input, Row, Select, Space } from 'antd';
import { Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';

interface DataType extends Record<string, string | number> { }

// 定义TableCRUD的传参
type TableCrudType = {
    api_url: string;
    title: string;
    columns: ResJsonTableColumn[];
    row: DataType;
    open: boolean;
    onClose: () => void;
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

export default ({ api_url, title, columns, row, open, onClose }: TableCrudType) => {
    const [modal, contextHolder] = Modal.useModal();

    const [form] = Form.useForm();
    const handleSubmit = () => {
        form.submit();
    };

    const onFinish = async (values: Record<string, string>) => {
        console.log(values)
        await fetch(api_url, {
            method: 'POST', // 指定请求方法
            headers: {
                'Content-Type': 'application/json', // 指定请求头，表明是 JSON 数据
            },
            body: JSON.stringify(values), // 将数据转换为 JSON 字符串
        })

    }

    const _onClose = () => {
        if (form.isFieldsTouched()) {
            modal.confirm({
                title: '确认提示',
                icon: <ExclamationCircleOutlined />,
                content: '内容修改尚未保存，还要离开吗？',
                okText: '离开',
                cancelText: '留下',
                onOk: () => {
                    form.resetFields();
                    onClose();
                },
                maskClosable: true,
            });
            return;
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
