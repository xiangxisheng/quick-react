import type { ApiFeedback } from './api.js';

export const getRedirectAfter = (feedback?: Pick<ApiFeedback, 'redirectAfter'>): number | null => {
	if (feedback?.redirectAfter === undefined || !Number.isFinite(feedback.redirectAfter)) return null;
	return Math.max(0, Math.floor(feedback.redirectAfter));
};

export const getRedirectDeadline = (feedback: Pick<ApiFeedback, 'redirectAfter'> | undefined, now = Date.now()): number | undefined => {
	const seconds = getRedirectAfter(feedback);
	return seconds === null || seconds === 0 ? undefined : now + seconds * 1000;
};
