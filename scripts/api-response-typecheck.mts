import type { ApiFeedbackOptions } from '@server/api-response.mjs';
import { apiResponse } from '@server/api-response.mjs';

const validOptions: ApiFeedbackOptions = { component: 'modal', type: 'info' };
void validOptions;

// @ts-expect-error 未声明的反馈组件必须在类型检查阶段失败。
const invalidOptions: ApiFeedbackOptions = { component: 'toast' };
void invalidOptions;

// @ts-expect-error 成功响应禁止使用顶层 message。
apiResponse(null as never, 200, { message: '成功' });
