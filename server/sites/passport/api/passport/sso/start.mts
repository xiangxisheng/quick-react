import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage } from '@server/api-response.mjs';
import { loadPassportSession } from '@server/passport/session.mjs';
import { createPassportSsoRequest, createSsoRequestCookie, issuePassportLoginTicket } from '@server/passport/sso.mjs';

const handler: ApiHandler = async (c) => {
	if (c.req.method !== 'GET') return apiMessage(c, 405, '只允许 GET 请求');
	const targetHostname = c.req.query('target_hostname')?.trim().toLowerCase() ?? '';
	const target = await c.get('globalDatabase').prepare(`SELECT h.site_key, h.hostname FROM global_site_hosts h
		JOIN global_sites s ON s.site_key = h.site_key WHERE h.hostname = ?1 AND h.status = 'enabled'
			AND s.status = 'enabled' AND s.migration_status = 'ready' AND h.site_key NOT IN ('global', 'passport')`).bind(targetHostname)
		.first<{ site_key: string; hostname: string }>();
	if (!target) return apiMessage(c, 400, '目标站点域名未注册或不可登录');
	const database = c.get('passportDatabase');
	if (!database) return apiMessage(c, 503, 'Passport 数据库不可用');
	const requestId = await createPassportSsoRequest(database, target.site_key, target.hostname);
	const secure = new URL(c.req.url).protocol === 'https:';
	c.header('Set-Cookie', createSsoRequestCookie(requestId, secure));
	const current = await loadPassportSession(database, c.req.raw);
	if (current) {
		const ticket = await issuePassportLoginTicket(database, requestId, String(current.id));
		if (!ticket) return apiMessage(c, 409, '跨站登录请求已失效');
		return c.redirect(ticket.redirectUrl, 302);
	}
	return c.redirect(`/sign${c.get('techStackConfig').pageSuffix}`, 302);
};

export default handler;
