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

export type ColumnComponentType = 'textbox' | 'url' | 'textarea' | 'select' | 'datepicker' | 'datepicker_rangepicker' | 'inputnumber' | 'upload';
export type ColumnDataType = 'js_timestamp' | 'int' | 'float' | 'string' | 'datetime';

export interface ResJsonTableColumn {
	dataIndex: string;
	title: string;
	component?: ColumnComponentType;
	rules?: ResJsonTableColumnRule[];
	ellipsis?: boolean;
	placeholder?: string;
	options?: ResJsonTableColumnSelectOption[];
	dataType?: ColumnDataType;
	dayjsFormat?: string;
}

export interface ResJsonTableOption {
	rowKey: string;
}

export interface ResJsonTable {
	option?: ResJsonTableOption;
	columns?: ResJsonTableColumn[];
	dataSource?: DataType[];
	totalRecords?: number,
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

	const getJsonByRes = async (res: Response): Promise<ResJSON> => {
		const text = await res.text();
		try {
			return JSON.parse(text);
		} catch (e) {
			return {
				title: 'JSON解析失败',
				message: text,
			}
		}
	};

	const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		try {
			const res: Response = await fetch(input, init);
			const resJSON: ResJSON = await getJsonByRes(res);
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
