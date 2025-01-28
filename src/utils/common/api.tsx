import { Modal, ModalFuncProps } from 'antd';
import { message } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';

/* 前端类型定义开始 */
export interface DataType extends Record<string, unknown> { }

interface ResJsonTableColumnRule {
	required: boolean;
	message: string;
}

interface ResJsonTableColumnSelectOption {
	value: string;
	text: string;
	color?: string;
	dataTypes?: string[];
}

export interface ResJsonTableColumn {
	dataIndex: string;
	title: string;
	component?: 'textbox' | 'url' | 'textarea' | 'select' | 'datepicker' | 'datepicker_rangepicker' | 'inputnumber';
	rules?: ResJsonTableColumnRule[];
	ellipsis?: boolean;
	placeholder?: string;
	options?: ResJsonTableColumnSelectOption[];
	dataType?: 'js_timestamp' | 'int' | 'float' | 'string' | 'datetime';
	dayjsFormat?: string;
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
	table?: ResJsonTable;
	title?: string;
	message?: string;
}
/* 前端类型定义结束 */

export interface CommonApi {
	modalError: (aContentLine: string[], props?: ModalFuncProps) => Promise<void>,
	modalConfirm: (aContentLine: string[], props?: ModalFuncProps) => Promise<boolean>
	apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export function useCommonApi(): [CommonApi, JSX.Element] {
	const [modalApi, contextHolderModal] = Modal.useModal();
	const [messageApi, contextHolderMessage] = message.useMessage();

	const getContentLine = (aContentLine: string[]): React.ReactNode => {
		return aContentLine.map((line, index) => (
			<div key={index}>{line}</div>
		))
	};

	const modalError = async (aContentLine: string[], props?: ModalFuncProps): Promise<void> => {
		await modalApi.error({
			title: '错误',
			icon: <ExclamationCircleOutlined />,
			content: getContentLine(aContentLine),
			maskClosable: true,
			...props,
		});
	};

	const modalConfirm = async (aContentLine: string[], props?: ModalFuncProps): Promise<boolean> => {
		return await modalApi.confirm({
			title: '确认提示',
			icon: <ExclamationCircleOutlined />,
			content: getContentLine(aContentLine),
			okText: '确定',
			cancelText: '取消',
			maskClosable: true,
			...props,
		});
	};

	const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		try {
			const res: Response = await fetch(input, init);
			const resJSON: ResJSON = await res.json();
			if (!res.ok) {
				const aContentLine = [];
				aContentLine.push(`${init?.method} ${input}`);
				aContentLine.push(`提交失败, 错误状态码: ${res.status}`);
				if (resJSON.message) {
					aContentLine.push(`消息: ${resJSON.message}`);
				}
				modalError(aContentLine);
				throw res;
			}
			res.json = async () => {
				return resJSON;
			}
			if (resJSON.title && resJSON.message) {
				modalApi.success({
					title: resJSON.title,
					content: resJSON.message,
				});
			}
			if (resJSON.message) {
				messageApi.success(resJSON.message);
			}
			return res;
		} catch (ex) {
			if (!ex) {
				modalError(['未知错误在apiFetch']);
				throw ex;
			}
			//modalError([ex.toString()]);
			throw ex;
		}
	};

	const commonApi: CommonApi = {
		modalError,
		modalConfirm,
		apiFetch,
	}

	return [
		commonApi,
		<>
			{contextHolderModal}
			{contextHolderMessage}
		</>,
	];
}
