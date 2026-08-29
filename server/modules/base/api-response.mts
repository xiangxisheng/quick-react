import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from './types.mjs';
import type { ApiFeedback, ApiFeedbackOptions, ApiSuccessData } from '@shared/types/api-response.mjs';
export type { ApiFeedback, ApiFeedbackOptions, ApiSuccessData } from '@shared/types/api-response.mjs';

const isSuccessStatus = (status: number) => status >= 200 && status < 300;

const defaultMessage = (status: number) => {
	if (status === 200) return '操作成功';
	if (status === 201) return '创建成功';
	if (status === 202) return '请求已接受';
	if (status === 204) return '操作成功';
	if (status === 400) return '请求参数错误';
	if (status === 401) return '请先登录';
	if (status === 403) return '无权执行此操作';
	if (status === 404) return '请求的资源不存在';
	if (status === 409) return '请求冲突';
	if (status === 422) return '数据校验失败';
	if (status === 429) return '请求过于频繁';
	if (status >= 200 && status < 300) return '操作成功';
	if (status >= 400 && status < 500) return '请求失败';
	return '服务器错误';
};

const writeApiResponse = (c: Context<AppEnv>, status: number, data: Record<string, unknown>) => (
	c.json(data, status as ContentfulStatusCode)
);

export const apiResponse = <T extends ApiSuccessData>(
	c: Context<AppEnv>,
	status: number,
	data: T,
) => c.json(data, status as ContentfulStatusCode);

const messagePayload = (
	status: number,
	message: string,
	feedbackOptions: ApiFeedbackOptions,
	data: Record<string, unknown>,
) => isSuccessStatus(status)
	? {
		...data,
		feedback: {
			component: 'message' as const,
			type: 'success' as const,
			message,
			...feedbackOptions,
		},
	}
	: {
		feedback: {
			component: 'modal' as const,
			type: 'error' as const,
			message,
			...feedbackOptions,
		},
	};

export const apiMessage = (
	c: Context<AppEnv>,
	status: number,
	message?: string,
	feedbackOptions: ApiFeedbackOptions = {},
	data: Record<string, unknown> = {},
) => {
	const payload = messagePayload(status, message ?? defaultMessage(status), feedbackOptions, data);
	return isSuccessStatus(status)
		? apiResponse(c, status, payload as ApiSuccessData)
		: writeApiResponse(c, status, payload);
};

export const apiMessageData = (
	c: Context<AppEnv>,
	status: number,
	message: string,
	data: Record<string, unknown>,
	feedbackOptions: ApiFeedbackOptions = {},
) => {
	const payload = messagePayload(status, message, feedbackOptions, data);
	return isSuccessStatus(status)
		? apiResponse(c, status, payload as ApiSuccessData)
		: writeApiResponse(c, status, payload);
};
