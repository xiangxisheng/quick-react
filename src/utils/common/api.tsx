import type React from 'react';
import { Modal, ModalFuncProps, Spin } from 'antd';
import { message } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { useState } from 'react';
import type { ApiFeedback as SharedApiFeedback, ApiResponseBody } from '@shared/types/api-response.mjs';
import type { TableColumn, TableData, TableOption, TableResponse } from '@shared/types/table.mjs';

/* 前端类型定义开始 */
export type DataType = TableData;
export type ColumnComponentType = TableColumn['component'];
export type ColumnDataType = TableColumn['dataType'];
export type ResJsonTableColumn = TableColumn;
export type ResJsonTableOption = TableOption;
export type ResJsonTable = TableResponse;

export type ApiFeedback = SharedApiFeedback;

export type ResJSON = ApiResponseBody;

type ParsedResJSON = ResJSON & { parseError?: boolean };
export type UploadFileOptions = {
	headers?: Record<string, string>;
	onProgress?: (loaded: number, total: number) => void;
	signal?: AbortSignal;
};
/* 前端类型定义结束 */

export interface CommonApi {
	modalError: (aContentLine: string[], props?: ModalFuncProps) => Promise<void>,
	modalConfirm: (aContentLine: string[], props?: ModalFuncProps) => Promise<boolean>
	apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
	uploadFile: (input: string | URL, file: Blob, options?: UploadFileOptions) => Promise<void>;
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

	const storageErrorMessage = (xhr: XMLHttpRequest): string => {
		let code = '';
		let message = '';
		let requestId = '';
		if (xhr.responseText) {
			try {
				const document = new DOMParser().parseFromString(xhr.responseText, 'application/xml');
				code = document.querySelector('Code')?.textContent?.trim() ?? '';
				message = document.querySelector('Message')?.textContent?.trim() ?? '';
				requestId = document.querySelector('RequestId')?.textContent?.trim() ?? '';
			} catch {
				// 非 XML 错误响应由 HTTP 状态兜底。
			}
		}
		return [
			`对象存储上传失败：HTTP ${xhr.status}${xhr.statusText ? ` ${xhr.statusText}` : ''}`,
			code && `错误码：${code}`,
			message && `错误信息：${message}`,
			requestId && `RequestId：${requestId}`,
		].filter(Boolean).join('\n');
	};

	const uploadFile = (input: string | URL, file: Blob, options: UploadFileOptions = {}): Promise<void> => new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		const abort = () => xhr.abort();
		const cleanup = () => options.signal?.removeEventListener('abort', abort);
		if (options.signal?.aborted) {
			reject(new DOMException('上传已取消', 'AbortError'));
			return;
		}
		xhr.open('PUT', input.toString());
		for (const [name, value] of Object.entries(options.headers ?? {})) xhr.setRequestHeader(name, value);
		xhr.upload.onprogress = (event) => {
			const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
			options.onProgress?.(event.loaded, total);
		};
		xhr.onload = () => {
			cleanup();
			if (xhr.status >= 200 && xhr.status < 300) {
				options.onProgress?.(file.size, file.size);
				resolve();
				return;
			}
			const error = new Error(storageErrorMessage(xhr));
			void modalError(error.message.split('\n'), { title: '上传失败' });
			reject(error);
		};
		xhr.onerror = () => {
			cleanup();
			const error = new Error('浏览器无法连接对象存储，请检查网络以及 Bucket 的 CORS 配置');
			void modalError([error.message], { title: '上传失败' });
			reject(error);
		};
		xhr.onabort = () => {
			cleanup();
			reject(new DOMException('上传已取消', 'AbortError'));
		};
		options.signal?.addEventListener('abort', abort, { once: true });
		xhr.send(file);
	});

	const commonApi: CommonApi = {
		modalError,
		modalConfirm,
		apiFetch,
		uploadFile,
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
