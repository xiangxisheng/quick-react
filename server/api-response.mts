import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from './types.mjs';

export type ApiFeedbackComponent = 'inline' | 'message' | 'modal' | 'none';
export type ApiFeedbackType = 'success' | 'info' | 'warning' | 'error';

export type ApiFeedback = {
	component: ApiFeedbackComponent;
	type: ApiFeedbackType;
	showIcon?: boolean;
	title?: string;
	message: string;
	refreshNowLabel?: string;
	cancelRefreshLabel?: string;
	redirectAfter?: number;
};

export type ApiFeedbackOptions = Partial<Omit<ApiFeedback, 'message'>>;
export type ApiSuccessData = Record<string, unknown> & { message?: never };

const isSuccessStatus = (status: number) => status >= 200 && status < 300;

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
	: { message };

export const apiMessage = (
	c: Context<AppEnv>,
	status: number,
	message: string,
	feedbackOptions: ApiFeedbackOptions = {},
	data: Record<string, unknown> = {},
) => {
	const payload = messagePayload(status, message, feedbackOptions, data);
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
