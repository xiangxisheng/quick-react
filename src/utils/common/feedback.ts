import type { ApiFeedback } from './api.js';

const DEFAULT_REDIRECT_AFTER = 2;

const getRedirectAfter = (feedback?: Pick<ApiFeedback, 'redirectAfter'>): number | null => {
	if (!feedback) return null;
	if (feedback.redirectAfter === undefined) return DEFAULT_REDIRECT_AFTER;
	if (!Number.isFinite(feedback.redirectAfter)) return null;
	return Math.max(0, Math.floor(feedback.redirectAfter));
};

const getRedirectDeadline = (feedback: Pick<ApiFeedback, 'redirectAfter'> | undefined, now = Date.now()): number | undefined => {
	const seconds = getRedirectAfter(feedback);
	return seconds === null || seconds === 0 ? undefined : now + seconds * 1000;
};

type FeedbackSchedule = {
	deadline?: number;
	cancel: () => void;
};

export const runAfterFeedback = (
	feedback: Pick<ApiFeedback, 'redirectAfter'> | undefined,
	action: () => void | Promise<void>,
): FeedbackSchedule => {
	const deadline = getRedirectDeadline(feedback);
	const run = () => { void action(); };
	if (!deadline) {
		run();
		return { cancel: () => undefined };
	}
	const timer = window.setTimeout(run, Math.max(0, deadline - Date.now()));
	return { deadline, cancel: () => window.clearTimeout(timer) };
};
