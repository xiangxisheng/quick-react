export type ApiFeedbackComponent = 'inline' | 'message' | 'modal' | 'none';
export type ApiFeedbackType = 'success' | 'info' | 'warning' | 'error';

export type ApiFeedback = {
	component?: ApiFeedbackComponent;
	type?: ApiFeedbackType;
	showIcon?: boolean;
	title?: string;
	message?: string;
	refreshNowLabel?: string;
	cancelRefreshLabel?: string;
	redirectAfter?: number;
};

export type ApiFeedbackOptions = Partial<Omit<ApiFeedback, 'message'>>;
export type ApiSuccessData = Record<string, unknown> & { message?: never };
