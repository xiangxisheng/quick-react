import type { ApiNextAction } from '@shared/types/api-response.mjs';

const handlers: Record<ApiNextAction['action'], (next: ApiNextAction) => void> = {
	reload: () => window.location.reload(),
	navigate: (next) => { if (next.action === 'navigate') window.location.assign(next.path); },
};

/** 统一执行后端下发的完成动作，业务组件不得自行推断刷新或跳转目标。 */
export const runApiNextAction = (next?: ApiNextAction) => { if (next) handlers[next.action](next); };
