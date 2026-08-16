import type React from 'react';
import { Modal, ModalFuncProps, Spin } from 'antd';
import { message } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { useState } from 'react';
import type { ApiFeedback as SharedApiFeedback } from '@shared/types/api-response.mjs';

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

export type ApiFeedback = SharedApiFeedback;

export interface ResJSON {
	table?: ResJsonTable;
	/** 仅用于兼容旧版错误接口；新接口必须使用 feedback.message。 */
	message?: string;
	feedback?: ApiFeedback;
}

type ParsedResJSON = ResJSON & { parseError?: boolean };
/* 前端类型定义结束 */

export interface CommonApi {
	modalError: (aContentLine: string[], props?: ModalFuncProps) => Promise<void>,
	modalConfirm: (aContentLine: string[], props?: ModalFuncProps) => Promise<boolean>
	apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export function useCommonApi(): [CommonApi, React.JSX.Element] {
	const [modalApi, contextHolderModal] = Modal.useModal();
	const [messageApi, contextHolderMessage] = message.useMessage();
	const [pendingRequests, setPendingRequests] = useState(0);

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

	const getJsonByRes = async (res: Response): Promise<ParsedResJSON> => {
		const text = await res.text();
		try {
			return JSON.parse(text);
		} catch {
			return {
				parseError: true,
				feedback: {
					component: 'modal',
					type: 'error',
					message: text || '响应不是有效 JSON',
				},
			}
		}
	};

	const showFeedback = (feedback: ApiFeedback, fallbackMessage: string, isError = false) => {
		if (feedback.component === 'none') return;
		const content = feedback.message ?? fallbackMessage;
		if (feedback.component === 'modal') {
			const modalOptions = {
				title: feedback.title ?? (isError ? '请求失败' : '提示'),
				content,
				okText: feedback.refreshNowLabel ?? '确定',
				cancelText: feedback.cancelRefreshLabel,
			};
			if (isError) modalApi.error(modalOptions);
			else modalApi.info(modalOptions);
		} else {
			messageApi.open({ key: 'api-feedback', type: feedback.type ?? (isError ? 'error' : 'success'), content });
		}
	};

	const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		setPendingRequests((count) => count + 1);
		try {
			const res: Response = await fetch(input, init);
			const resJSON: ParsedResJSON = await getJsonByRes(res);
			if (!res.ok || resJSON.parseError) {
				showFeedback(resJSON.feedback ?? (resJSON.message ? {
					component: 'modal',
					type: 'error',
					message: resJSON.message,
				} : {
					component: 'modal',
					type: 'error',
					message: res.ok
						? `${init?.method ?? '请求'} ${input} 返回了无效 JSON`
						: `${init?.method ?? '请求'} ${input} 失败，错误状态码: ${res.status}`,
				}), '', true);
				throw res;
			}
			res.json = async () => {
				const { parseError: _parseError, ...responseJSON } = resJSON;
				return responseJSON;
			}
			if (resJSON.feedback || resJSON.message) {
				const feedback = resJSON.feedback ?? {
					component: 'message' as const,
					type: 'success' as const,
					message: resJSON.message ?? '',
				};
				showFeedback(feedback, '', feedback.type === 'error');
			}
			return res;
		} catch (ex) {
			if (!ex) {
				modalError(['未知错误在apiFetch']);
				throw ex;
			}
			//modalError([ex.toString()]);
			throw ex;
		} finally {
			setPendingRequests((count) => Math.max(0, count - 1));
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
			<Spin fullscreen spinning={pendingRequests > 0} />
			{contextHolderModal}
			{contextHolderMessage}
		</>,
	];
}
