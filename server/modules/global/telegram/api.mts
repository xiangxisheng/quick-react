export type TelegramBotIdentity = {
	id: string;
	username: string;
	firstName: string;
};

export type TelegramWebhookInfo = {
	url: string;
	pendingUpdateCount: number;
	lastErrorDate?: number;
	lastErrorMessage?: string;
};

type TelegramResponse<T> = {
	ok?: boolean;
	result?: T;
	description?: string;
};

export const telegramRequest = async <T,>(token: string, method: string, parameters: Record<string, unknown> = {}) => {
	let response: Response;
	try {
		response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify(parameters),
		});
	} catch {
		throw new Error('Telegram API 网络请求失败');
	}
	const result = await response.json().catch(() => ({})) as TelegramResponse<T>;
	if (!response.ok || result.ok !== true || result.result === undefined) {
		throw new Error(typeof result.description === 'string' && result.description.trim()
			? `Telegram API：${result.description.trim()}`
			: `Telegram API 请求失败（HTTP ${response.status}）`);
	}
	return result.result;
};

export type TelegramInlineKeyboard = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

export const sendTelegramMessage = async (token: string, chatId: string, text: string, replyMarkup?: TelegramInlineKeyboard) => {
	const result = await telegramRequest<{ message_id: number | string }>(token, 'sendMessage', {
		chat_id: chatId,
		text,
		...(replyMarkup ? { reply_markup: replyMarkup } : {}),
	});
	return { messageId: String(result.message_id) };
};

export const editTelegramMessage = (token: string, chatId: string, messageId: string, text: string, replyMarkup?: TelegramInlineKeyboard) => telegramRequest<unknown>(token, 'editMessageText', {
	chat_id: chatId,
	message_id: messageId,
	text,
	...(replyMarkup ? { reply_markup: replyMarkup } : {}),
});

export const deleteTelegramMessage = (token: string, chatId: string, messageId: string) => telegramRequest<boolean>(token, 'deleteMessage', {
	chat_id: chatId,
	message_id: messageId,
});

export const answerTelegramCallback = (token: string, callbackQueryId: string, text = '') => telegramRequest<boolean>(token, 'answerCallbackQuery', {
	callback_query_id: callbackQueryId,
	...(text ? { text } : {}),
});

export const getTelegramBotIdentity = async (token: string): Promise<TelegramBotIdentity> => {
	const result = await telegramRequest<{ id: number | string; username?: string; first_name?: string }>(token, 'getMe');
	const username = String(result.username ?? '').trim();
	if (!username) throw new Error('Telegram 机器人没有 Username');
	return { id: String(result.id), username, firstName: String(result.first_name ?? '').trim() || username };
};

export const setTelegramWebhook = (token: string, url: string, secretToken: string) => telegramRequest<boolean>(token, 'setWebhook', {
	url,
	secret_token: secretToken,
	allowed_updates: ['message', 'callback_query'],
});

export const deleteTelegramWebhook = (token: string) => telegramRequest<boolean>(token, 'deleteWebhook');

export const getTelegramWebhookInfo = async (token: string): Promise<TelegramWebhookInfo> => {
	const result = await telegramRequest<{
		url?: string;
		pending_update_count?: number;
		last_error_date?: number;
		last_error_message?: string;
	}>(token, 'getWebhookInfo');
	return {
		url: String(result.url ?? ''),
		pendingUpdateCount: Number(result.pending_update_count ?? 0),
		...(typeof result.last_error_date === 'number' ? { lastErrorDate: result.last_error_date } : {}),
		...(typeof result.last_error_message === 'string' && result.last_error_message ? { lastErrorMessage: result.last_error_message } : {}),
	};
};
