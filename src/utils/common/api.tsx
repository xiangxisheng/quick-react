import { Modal, ModalFuncProps } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';

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

export interface CommonApi {
    apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    modalConfirm: (props: ModalFuncProps) => Promise<boolean>
}

export function useCommonApi() {
    const [modal, contextHolder] = Modal.useModal();

    const modalError = (aContentLine: string[]) => {
        modal.error({
            title: '错误',
            icon: <ExclamationCircleOutlined />,
            content: aContentLine.map((line, index) => (
                <div key={index}>{line}</div>
            )),
            maskClosable: true,
        });
    };


    const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        try {
            const res: Response = await fetch(input, init);
            if (!res.ok) {
                const aContentLine = [];
                aContentLine.push(`${init?.method} ${input}`);
                aContentLine.push(`提交失败, 错误状态码: ${res.status}`);
                modalError(aContentLine);
                throw res;
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
        } catch (ex) {
            if (!ex) {
                modalError(['未知错误在apiFetch']);
                throw ex;
            }
            modalError([ex.toString()]);
            throw ex;
        }
    };

    const modalConfirm = async (props: ModalFuncProps): Promise<boolean> => {
        return await modal.confirm({
            title: '确认提示',
            icon: <ExclamationCircleOutlined />,
            okText: '确定',
            cancelText: '取消',
            maskClosable: true,
            ...props,
        });
    };

    const commonApi: CommonApi = {
        apiFetch,
        modalConfirm,
    }

    return {
        commonApi,
        contextHolder,
    };
}
