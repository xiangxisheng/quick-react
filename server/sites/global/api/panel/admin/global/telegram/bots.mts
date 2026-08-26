import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { getChangedFields } from '@server/changed-fields.mjs';
import type { DatabaseAdapter } from '@server/database/index.mjs';
import { deleteTelegramWebhook, getTelegramBotIdentity, getTelegramWebhookInfo, setTelegramWebhook } from '@server/telegram/api.mjs';
import { enabledDisabledOptions, statusValues } from '@shared/types/status.mjs';

const columns = [
	{ dataIndex: 'name', title: '名称', component: 'textbox', rules: [{ required: true, message: '请输入名称' }] },
	{ dataIndex: 'bot_username', title: 'Bot Username' },
	{ dataIndex: 'bot_token', title: 'Bot Token', component: 'textbox', inputType: 'password', hideInTable: true, placeholder: '新增时必填；编辑时留空表示保持原值' },
	{ dataIndex: 'secret_token', title: 'Secret Token', component: 'textbox', inputType: 'password', hideInTable: true, placeholder: '留空由系统生成；编辑时留空表示保持原值' },
	{ dataIndex: 'webhook_hostname', title: 'Webhook 域名', component: 'select', placeholder: '选择 Passport 站点域名', rules: [{ required: true, message: '请选择 Webhook 域名' }] },
	{ dataIndex: 'status', title: '状态', component: 'switch', checkedValue: statusValues.enabled, uncheckedValue: statusValues.disabled, options: enabledDisabledOptions },
	{ dataIndex: 'created_at', title: '创建时间', dataType: 'js_timestamp' as const, dayjsFormat: 'YYYY-MM-DD HH:mm:ss' },
	{ dataIndex: 'updated_at', title: '更新时间', dataType: 'js_timestamp' as const, dayjsFormat: 'YYYY-MM-DD HH:mm:ss' },
];

type BotRow = {
	id: number;
	name: string;
	bot_token: string;
	bot_username: string;
	secret_token: string;
	webhook_hostname: string;
	status: string;
	created_at: number;
	updated_at: number;
};

const parseBody = async (c: Parameters<ApiHandler>[0]): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({}));
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const secretPattern = /^[A-Za-z0-9_-]{1,256}$/;
const createSecretToken = () => crypto.randomUUID().replaceAll('-', '');
const webhookUrl = (hostname: string, botId: number) => `https://${hostname}/api/tgwebhook?bot_id=${encodeURIComponent(String(botId))}`;

const passportHostOptions = async (database: DatabaseAdapter) => {
	const rows = await database.prepare(`SELECT hostname FROM global_site_hosts
		WHERE site_key = 'passport' AND status = 'enabled' ORDER BY hostname`).all<{ hostname: string }>();
	return rows.results.map((row) => ({ value: row.hostname, text: row.hostname }));
};

const validatePassportHost = async (database: DatabaseAdapter, hostname: string) => Boolean(await database.prepare(`SELECT id FROM global_site_hosts
	WHERE hostname = ?1 AND site_key = 'passport' AND status = 'enabled'`).bind(hostname).first());

const publicRow = (row: BotRow) => ({
	id: row.id,
	name: row.name,
	bot_username: row.bot_username,
	webhook_hostname: row.webhook_hostname,
	status: row.status,
	created_at: row.created_at,
	updated_at: row.updated_at,
});

const loadBot = (database: DatabaseAdapter, id: number) => database.prepare(`SELECT id, name, bot_token, bot_username,
	secret_token, webhook_hostname, status, created_at, updated_at FROM global_telegram_bots WHERE id = ?1`)
	.bind(id).first<BotRow>();

const removeBot = async (c: Parameters<ApiHandler>[0], id: number) => {
	const database = c.get('database');
	const bot = await loadBot(database, id);
	if (!bot) return undefined;
	if (bot.status !== statusValues.disabled) return apiMessage(c, 409, '机器人必须先停用才能删除');
	const passportDatabase = c.get('passportDatabase');
	if (!passportDatabase) return apiMessage(c, 503, 'Passport 数据库不可用，无法确认关联数据');
	const associated = await passportDatabase.prepare(`SELECT bot_id FROM passport_telegram_accounts WHERE bot_id = ?1
		UNION ALL SELECT bot_id FROM passport_email_otp WHERE bot_id = ?1
		UNION ALL SELECT bot_id FROM passport_telegram_menus WHERE bot_id = ?1
		UNION ALL SELECT bot_id FROM passport_telegram_updates WHERE bot_id = ?1 LIMIT 1`).bind(id).first();
	if (associated) return apiMessage(c, 409, '机器人存在 Passport 账号关联，只能保持停用，不能删除');
	await database.prepare('DELETE FROM global_telegram_bots WHERE id = ?1').bind(id).run();
	return undefined;
};

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('database');
	if (!params.id && c.req.method === 'GET') {
		const [rows, hosts] = await Promise.all([
			database.prepare(`SELECT id, name, bot_token, bot_username, secret_token, webhook_hostname,
				status, created_at, updated_at FROM global_telegram_bots ORDER BY id DESC`).all<BotRow>(),
			passportHostOptions(database),
		]);
		const tableColumns = columns.map((column) => column.dataIndex === 'webhook_hostname' ? { ...column, options: hosts } : column);
		return apiResponse(c, 200, { table: { option: { rowKey: 'id', actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'create', label: '新增' }, { key: 'delete', label: '删除' }], row: [{ key: 'test', label: 'Webhook 状态' }, { key: 'edit', label: '编辑' }, { key: 'delete', label: '删除', confirm: '机器人必须已停用且没有关联数据，确认删除吗？' }] } }, columns: tableColumns, dataSource: rows.results.map(publicRow), totalRecords: rows.results.length } });
	}
	if (!params.id && c.req.method === 'POST') {
		const body = await parseBody(c);
		const name = text(body.name), token = text(body.bot_token), hostname = text(body.webhook_hostname);
		const secretToken = text(body.secret_token) || createSecretToken();
		const status = body.status === statusValues.disabled ? statusValues.disabled : statusValues.enabled;
		if (!name || !token || !secretPattern.test(secretToken) || !await validatePassportHost(database, hostname)) return apiMessage(c, 400, '名称、Bot Token、Secret Token 或 Passport 域名不合法');
		let identity;
		try { identity = await getTelegramBotIdentity(token); }
		catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : 'Bot Token 校验失败'); }
		try {
			await database.prepare(`INSERT INTO global_telegram_bots
				(name, bot_token, bot_username, secret_token, webhook_hostname, status, created_at, updated_at)
				VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`).bind(name, token, identity.username, secretToken, hostname, status, Date.now()).run();
		} catch { return apiMessage(c, 409, '机器人名称、Token 或 Username 已存在'); }
		const created = await database.prepare('SELECT id FROM global_telegram_bots WHERE bot_token = ?1').bind(token).first<{ id: number }>();
		if (!created) return apiMessage(c, 500, '机器人创建后无法读取');
		if (status === statusValues.enabled) {
			try { await setTelegramWebhook(token, webhookUrl(hostname, created.id), secretToken); }
			catch (error) {
				await database.prepare('DELETE FROM global_telegram_bots WHERE id = ?1').bind(created.id).run();
				return apiMessage(c, 502, error instanceof Error ? error.message : 'Webhook 设置失败');
			}
		}
		return apiMessageData(c, 201, status === statusValues.enabled ? '机器人已创建并设置 Webhook' : '机器人已创建并保持停用', { id: String(created.id), bot_username: identity.username });
	}
	if (!params.id && c.req.method === 'DELETE') {
		const ids = await c.req.json<unknown>().catch(() => []);
		for (const value of Array.isArray(ids) ? ids : []) {
			const response = await removeBot(c, Number(value));
			if (response) return response;
		}
		return apiMessage(c, 200, '删除成功');
	}
	const id = Number(params.id);
	if (!Number.isSafeInteger(id) || id <= 0) return apiMessage(c, 400, '机器人 ID 不合法');
	if (c.req.method === 'GET') {
		const bot = await loadBot(database, id);
		return bot ? apiResponse(c, 200, publicRow(bot)) : apiMessage(c, 404, '机器人不存在');
	}
	if (c.req.method === 'POST' && c.req.query('action') === 'test') {
		const bot = await loadBot(database, id);
		if (!bot) return apiMessage(c, 404, '机器人不存在');
		try {
			const info = await getTelegramWebhookInfo(bot.bot_token);
			const lastError = info.lastErrorMessage ? `；最近错误：${info.lastErrorMessage}` : '';
			return apiMessageData(c, 200, `Webhook：${info.url || '未设置'}；待处理更新：${info.pendingUpdateCount}${lastError}`, { webhook: info }, { component: 'modal', title: 'Telegram Webhook 状态' });
		} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : 'Webhook 状态查询失败'); }
	}
	if (c.req.method === 'PUT') {
		const current = await loadBot(database, id);
		if (!current) return apiMessage(c, 404, '机器人不存在');
		const body = await parseBody(c);
		const changed = getChangedFields(body, ['name', 'bot_token', 'secret_token', 'webhook_hostname', 'status']);
		const name = changed.has('name') ? text(body.name) : current.name;
		const token = changed.has('bot_token') && text(body.bot_token) ? text(body.bot_token) : current.bot_token;
		const secretToken = changed.has('secret_token') && text(body.secret_token) ? text(body.secret_token) : current.secret_token;
		const hostname = changed.has('webhook_hostname') ? text(body.webhook_hostname) : current.webhook_hostname;
		const status = changed.has('status') ? body.status === statusValues.disabled ? statusValues.disabled : statusValues.enabled : current.status;
		if (!name || !secretPattern.test(secretToken) || !await validatePassportHost(database, hostname)) return apiMessage(c, 400, '名称、Secret Token 或 Passport 域名不合法');
		let username = current.bot_username;
		if (token !== current.bot_token) {
			try { username = (await getTelegramBotIdentity(token)).username; }
			catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : 'Bot Token 校验失败'); }
		}
		const duplicate = await database.prepare(`SELECT id FROM global_telegram_bots
			WHERE id != ?1 AND (name = ?2 OR bot_token = ?3 OR bot_username = ?4) LIMIT 1`).bind(id, name, token, username).first();
		if (duplicate) return apiMessage(c, 409, '机器人名称、Token 或 Username 已存在');
		try {
			if (status === statusValues.enabled) await setTelegramWebhook(token, webhookUrl(hostname, id), secretToken);
			else if (current.status === statusValues.enabled || token !== current.bot_token) await deleteTelegramWebhook(current.bot_token);
			if (token !== current.bot_token && current.status === statusValues.enabled) await deleteTelegramWebhook(current.bot_token).catch(() => undefined);
		} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : 'Webhook 更新失败'); }
		await database.prepare(`UPDATE global_telegram_bots SET name = ?2, bot_token = ?3, bot_username = ?4,
			secret_token = ?5, webhook_hostname = ?6, status = ?7, updated_at = ?8 WHERE id = ?1`)
			.bind(id, name, token, username, secretToken, hostname, status, Date.now()).run();
		return apiMessage(c, 200, status === statusValues.enabled ? '机器人已保存并更新 Webhook' : '机器人已停用并删除 Webhook');
	}
	if (c.req.method === 'DELETE') {
		const response = await removeBot(c, id);
		return response ?? apiMessage(c, 200, '删除成功');
	}
	return next();
};

export const acceptsTrailingParams = true;
export default handler;
