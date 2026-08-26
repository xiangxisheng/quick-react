import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { clearPassportSessionCookie, readPassportSessionId } from './session.mjs';
import type { FormPageConfig } from '@shared/types/form-page.mjs';

const handler: ApiHandler = async (c, next) => {
	const site = c.get('site'), database = c.get('passportDatabase');
	if (!site.passportSsoEnabled) return apiMessage(c, 404, '该站点未启用 Passport SSO 登录');
	if (!database) return apiMessage(c, 503, 'Passport 数据库不可用');
	if (c.req.method === 'GET') {
		const hosts = await c.get('globalDatabase').prepare(`SELECT hostname FROM global_site_hosts
			WHERE site_key = 'passport' AND status = 'enabled' AND hostname NOT LIKE '*.%' ORDER BY hostname`).all<{ hostname: string }>();
		if (!hosts.results.length) return apiMessage(c, 503, '没有可用的 Passport 登录域名');
		const options = hosts.results.map((item) => ({ value: item.hostname, text: item.hostname }));
		const formPage: FormPageConfig = {
			description: '选择可用的 Passport 域名完成统一登录；域名发生故障时可改选其他域名。',
			submitLabel: '前往 Passport 登录',
			initialValues: { passport_hostname: options[0].value },
			fields: [{ name: 'passport_hostname', label: 'Passport 域名', type: 'select', options, rules: [{ required: true, message: '请选择 Passport 域名' }] }],
		};
		return apiResponse(c, 200, { user: c.get('currentUser') ?? null, registrationAvailable: false, formPage });
	}
	if (c.req.method === 'POST') {
		const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
		const hostname = typeof body.passport_hostname === 'string' ? body.passport_hostname.trim().toLowerCase() : '';
		const valid = await c.get('globalDatabase').prepare(`SELECT hostname FROM global_site_hosts
			WHERE hostname = ?1 AND site_key = 'passport' AND status = 'enabled' AND hostname NOT LIKE '*.%'`).bind(hostname).first();
		if (!valid) return apiMessage(c, 400, 'Passport 域名不可用');
		return apiResponse(c, 200, {
			redirectTo: `https://${hostname}/api/passport/sso/start?target_hostname=${encodeURIComponent(site.hostname)}`,
			feedback: { component: 'message', type: 'success', message: '正在前往 Passport 登录', redirectAfter: 0 },
		});
	}
	if (c.req.method === 'PUT') return apiMessage(c, 403, '业务站点不能创建本地用户，请通过 Passport 登录');
	if (c.req.method === 'DELETE') {
		const sessionId = readPassportSessionId(c.req.raw);
		if (sessionId) await database.prepare(`DELETE FROM passport_site_sessions WHERE id = ?1 AND site_key = ?2 AND hostname = ?3`)
			.bind(sessionId, site.siteKey, site.hostname).run();
		c.header('Set-Cookie', clearPassportSessionCookie(new URL(c.req.url).protocol === 'https:'));
		return apiMessage(c, 200, '已退出登录');
	}
	return next();
};

export default handler;
