import { Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { unstable_renderSubtreeIntoContainer } from 'react-dom';

/* 类型定义开始 */
export interface DataType extends Record<string, unknown> { }

interface ResJsonTableColumnRule {
    required: boolean;
    message: string;
}

interface ResJsonTableColumnSelectOption {
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
    options?: ResJsonTableColumnSelectOption[];
}

export interface ResJsonTableOption {
    rowKey: string;
}

export interface ResJsonTable {
    option?: ResJsonTableOption;
    columns?: ResJsonTableColumn[];
    dataSource?: DataType[];
}

export interface ResJSON {
    table?: ResJsonTable,
    message?: string;
}
/* 类型定义结束 */

export function useCommonApi() {
    const [modal, contextHolder] = Modal.useModal();

    const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        let res: Response = new Response();
        try {
            res = await fetch(input, init);
            if (!res.ok) {
                modal.error({
                    title: '错误',
                    icon: <ExclamationCircleOutlined />,
                    content: `提交失败, 错误状态码: ${res.status}`,
                    maskClosable: true,
                });
                return res;
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
        } catch (ex) {
            if (!ex) {
                return res;
            }
            modal.error({
                title: '错误',
                icon: <ExclamationCircleOutlined />,
                content: ex.toString(),
                maskClosable: true,
            });
        }
        return res;
    };

    return {
        apiFetch,
        contextHolder,
    };
}
