import type React from 'react';
import { Modal, ModalFuncProps, Spin } from 'antd';
import { message } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { useState } from 'react';

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

export interface ApiFeedback {
	component?: 'inline' | 'message' | 'modal' | 'none';
	type?: 'success' | 'info' | 'warning' | 'error';
	showIcon?: boolean;
	title?: string;
	message?: string;
	refreshNowLabel?: React.ReactNode;
	cancelRefreshLabel?: React.ReactNode;
}

export interface ResJSON {
	table?: ResJsonTable;
	title?: string;
	message?: string;
	feedback?: ApiFeedback;
}
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
		setPendingRequests((count) => count + 1);
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
			if (resJSON.feedback && resJSON.feedback.component !== 'none') {
				const feedback = resJSON.feedback;
				if (feedback.component === 'modal') {
					modalApi.info({
						title: feedback.title ?? '提示',
						content: feedback.message ?? resJSON.message ?? '',
						okText: feedback.refreshNowLabel ?? '确定',
						cancelText: feedback.cancelRefreshLabel,
					});
				} else {
					messageApi.open({ key: 'api-feedback', type: feedback.type ?? 'success', content: feedback.message ?? resJSON.message ?? '' });
				}
			} else if (resJSON.title && resJSON.message) {
				modalApi.success({
					title: resJSON.title,
					content: resJSON.message,
				});
			}
			if (!resJSON.feedback && resJSON.message) {
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
