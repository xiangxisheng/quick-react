import { Button, Col, DatePicker, Drawer, Form, Input, Row, Select, Space } from 'antd';
const { Option } = Select;

interface DataType extends Record<string, string | number> { }

// 定义TableCRUD的传参
type TableCrudType = {
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
                    <Option value="xiao">Xiaoxiao Fu</Option>
                    <Option value="mao">Maomao Zhou</Option>
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

export default ({ title, columns, row, open, onClose }: TableCrudType) => {

    const [form] = Form.useForm();
    const handleSubmit = () => {
        form.submit();
    };

    return (<Drawer
        title={title}
        width={720}
        onClose={onClose}
        open={open}
        styles={{
            body: {
                paddingBottom: 80,
            },
        }}
        extra={
            <Space>
                <Button onClick={onClose}>Cancel</Button>
                <Button onClick={handleSubmit} type="primary">
                    Submit
                </Button>
            </Space>
        }
    >
        <Form layout="vertical" form={form}>
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
    </Drawer>);
};
