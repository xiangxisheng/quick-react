import { Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';

export interface DataType extends Record<string, string | number> { }

interface ResJsonTableColumnRule {
    required: boolean;
    message: string;
}

interface SelectOption {
    value: string;
    text: string;
}

export interface ResJsonTableColumn {
    dataIndex: string;
    title: string;
    form?: string;
    rules?: ResJsonTableColumnRule[];
    ellipsis?: boolean;
    placeholder?: string;
    options?: SelectOption[];
}

export interface ResJSON {
    columns?: ResJsonTableColumn[];
    dataSource?: DataType[];
    message?: string;
}

export function useCommonApi() {
    const [modal, contextHolder] = Modal.useModal();

    const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const res: Response = await fetch(input, init);
        if (!res.ok) {
            modal.error({
                title: '错误',
                icon: <ExclamationCircleOutlined />,
                content: `提交失败, 错误状态码: ${res.status}`,
                maskClosable: true,
            });
            throw new Error(`请求失败，状态码：${res.status}`);
        }
        const resJSON: ResJSON = await res.json();
        res.json = async () => {
            return resJSON;
        }
        if (resJSON.message) {
            modal.success({
                title: '成功',
                content: resJSON.message,
            });
        }
        return res;
    };

    return {
        apiFetch,
        contextHolder,
    };
}
