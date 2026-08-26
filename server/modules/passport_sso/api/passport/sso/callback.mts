import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage } from '@server/api-response.mjs';
import { createPassportSessionCookie } from '@server/passport/session.mjs';
import { passportTicketHash } from '@server/passport/sso.mjs';

const handler: ApiHandler = async (c) => {
	if (c.req.method !== 'GET') return apiMessage(c, 405, '只允许 GET 请求');
	const site = c.get('site');
	if (site.siteKey === 'global' || site.siteKey === 'passport' || !site.passportSsoEnabled) return apiMessage(c, 404, '该站点未启用 Passport SSO 登录');
	const token = c.req.query('ticket')?.trim() ?? '';
	if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return apiMessage(c, 400, '登录票据不合法');
	const database = c.get('passportDatabase');
	if (!database?.batch) return apiMessage(c, 503, 'Passport 数据库不可用');
	const tokenHash = await passportTicketHash(token), sessionId = crypto.randomUUID(), now = Date.now(), maxAge = 24 * 60 * 60;
	await database.batch([
		{ query: `INSERT INTO passport_site_sessions (id, user_id, site_key, hostname, expires_at, created_at)
			SELECT ?1, user_id, target_site_key, target_hostname, ?5, ?6 FROM passport_login_tickets
			WHERE token_hash = ?2 AND target_site_key = ?3 AND target_hostname = ?4 AND status = 'pending' AND expires_at > ?6`,
		values: [sessionId, tokenHash, site.siteKey, site.hostname, now + maxAge * 1000, now] },
		{ query: `UPDATE passport_login_tickets SET status = CASE WHEN expires_at > ?4 THEN 'consumed' ELSE 'expired' END, updated_at = ?4
			WHERE token_hash = ?1 AND target_site_key = ?2 AND target_hostname = ?3 AND status = 'pending'`, values: [tokenHash, site.siteKey, site.hostname, now] },
	]);
	const created = await database.prepare(`SELECT id FROM passport_site_sessions WHERE id = ?1`).bind(sessionId).first();
	if (!created) return apiMessage(c, 409, '登录票据已使用、已过期或目标站点不匹配');
	c.header('Set-Cookie', createPassportSessionCookie(sessionId, new URL(c.req.url).protocol === 'https:', maxAge));
	return c.redirect('/', 302);
};

export default handler;
