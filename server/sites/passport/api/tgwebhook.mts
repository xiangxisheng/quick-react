import type { ApiHandler } from '@server/api-router.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { handlePassportTelegramUpdate, type PassportTelegramUpdate } from '@server/passport/telegram-webhook.mjs';
import { firstSql, runSql, sql } from '@server/database/sql.mjs';

type TelegramBot = {
	id: number | bigint;
	bot_token: string;
	secret_token: string;
	webhook_hostname: string;
};

const jsonStatus = (c: Parameters<ApiHandler>[0], status: number, value: string) => c.json({ status: value }, status as 200 | 400 | 403 | 404 | 405 | 500);
const decimalPattern = /^[1-9]\d*$/;
const loadBot = (database: DatabaseAdapter, botId: string, hostname: string) => firstSql<TelegramBot>(database, sql(database).select({ table: 'global_telegram_bots', columns: { id: 'id', bot_token: 'bot_token', secret_token: 'secret_token', webhook_hostname: 'webhook_hostname' }, where: [{ column: 'id', value: botId }, { column: 'webhook_hostname', value: hostname }, { column: 'status', value: 'enabled' }] }));

const constantTimeEqual = async (actual: string, expected: string) => {
	const [actualHash, expectedHash] = await Promise.all([
		crypto.subtle.digest('SHA-256', new TextEncoder().encode(actual)),
		crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected)),
	]);
	const left = new Uint8Array(actualHash), right = new Uint8Array(expectedHash);
	let difference = actual.length ^ expected.length;
	for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
	return difference === 0;
};

const parseUpdate = (value: unknown): PassportTelegramUpdate | undefined => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const updateId = (value as Record<string, unknown>).update_id;
	if (!Number.isSafeInteger(updateId) || Number(updateId) < 0) return undefined;
	return value as PassportTelegramUpdate;
};

const claimUpdate = async (database: DatabaseAdapter, botId: string, updateId: number) => {
	const now = Date.now();
	try {
		await runSql(database, sql(database).insert('passport_telegram_updates', { bot_id: botId, update_id: updateId, status: 'processing', created_at: now, updated_at: now }));
		return true;
	} catch {
		const existing = await firstSql<{ status: string }>(database, sql(database).select({ table: 'passport_telegram_updates', columns: { status: 'status' }, where: [{ column: 'bot_id', value: botId }, { column: 'update_id', value: updateId }] }));
		if (!existing || existing.status !== 'failed') return false;
		await runSql(database, sql(database).update('passport_telegram_updates', { status: 'processing', updated_at: now }, [{ column: 'bot_id', value: botId }, { column: 'update_id', value: updateId }, { column: 'status', value: 'failed' }]));
		return true;
	}
};

const handler: ApiHandler = async (c) => {
	if (c.req.method !== 'POST') {
		c.header('Allow', 'POST');
		return jsonStatus(c, 405, 'method_not_allowed');
	}
	const botId = c.req.query('bot_id')?.trim() ?? '';
	if (!decimalPattern.test(botId)) return jsonStatus(c, 400, 'bad_request');
	const hostname = new URL(c.req.url).hostname.toLowerCase();
	const bot = await loadBot(c.get('globalDatabase'), botId, hostname);
	if (!bot) return jsonStatus(c, 404, 'bot_not_found');
	const suppliedSecret = c.req.header('x-telegram-bot-api-secret-token') ?? '';
	if (!await constantTimeEqual(suppliedSecret, bot.secret_token)) return jsonStatus(c, 403, 'forbidden');
	const update = parseUpdate(await c.req.json<unknown>().catch(() => undefined));
	if (!update) return jsonStatus(c, 400, 'bad_request');
	const database = c.get('passportDatabase');
	if (!database) return jsonStatus(c, 500, 'error');
	if (!await claimUpdate(database, botId, update.update_id)) return jsonStatus(c, 200, 'ok');
	try {
		await handlePassportTelegramUpdate(database, c.get('globalDatabase'), c.env.SNOWFLAKE_WORKER_ID, {
			id: String(bot.id),
			botToken: bot.bot_token,
		}, update);
		await runSql(database, sql(database).update('passport_telegram_updates', { status: 'completed', updated_at: Date.now() }, { bot_id: botId, update_id: update.update_id }));
		return jsonStatus(c, 200, 'ok');
	} catch (error) {
		await runSql(database, sql(database).update('passport_telegram_updates', { status: 'failed', updated_at: Date.now() }, { bot_id: botId, update_id: update.update_id })).catch(() => undefined);
		console.error('Passport Telegram webhook update failed', error instanceof Error ? error.message : 'unknown error');
		return jsonStatus(c, 500, 'error');
	}
};

export default handler;
