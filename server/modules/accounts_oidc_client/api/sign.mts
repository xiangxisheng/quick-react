import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import baseSign from '@server/sites/base/api/sign.mjs';
import { accountsLoginCookie, loadAccountsOidcConfig, loadDiscovery } from '@server/accounts/client.mjs';
import { randomToken, sha256Base64Url } from '@server/accounts/oidc.mjs';
import type { FormPageConfig } from '@shared/types/form-page.mjs';
import { runSql, sql } from '@server/database/sql.mjs';
import { isSecureRequest, requestOrigin } from '@server/request-origin.mjs';

const handler: ApiHandler = async (c, next) => {
	const config = await loadAccountsOidcConfig(c);
	if (!config.enabled) return baseSign(c, next, {});
	if (c.req.method === 'GET') {
		const currentUser = c.get('currentUser') ?? null;
		const formPage: FormPageConfig = {
			description: '使用 Accounts 账号中心完成统一登录。点击下方按钮将打开 Accounts 登录窗口，完成后自动返回本站；本页不会自动跳转。',
			submitLabel: '前往 Accounts 登录',
			passportLogin: { enabled: true },
			initialValues: { action: 'login' },
			fields: [{ name: 'action', label: '', type: 'hidden' }],
		};
		return apiResponse(c, 200, { user: currentUser, registrationAvailable: false, formPage });
	}
	if (c.req.method === 'POST') {
		try {
			const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
			const discovery = await loadDiscovery(c, config.issuer), id = crypto.randomUUID(), state = randomToken(), nonce = randomToken(), verifier = randomToken(48), now = Date.now();
			const database = c.get('database');
			await runSql(database, sql(database).insert('base_oidc_login_requests', { id, issuer: config.issuer, state, nonce, code_verifier: verifier, return_path: '/', expires_at: now + 600_000, created_at: now }));
			const callback = `${requestOrigin(c)}/api/accounts/oidc/callback`;
			const authorize = new URL(discovery.authorization_endpoint); authorize.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: callback, scope: 'openid profile email', state, nonce, code_challenge: await sha256Base64Url(verifier), code_challenge_method: 'S256' }).toString();
			c.header('Set-Cookie', accountsLoginCookie(id, isSecureRequest(c)));
			return apiResponse(c, 200, { redirectTo: authorize.toString(), feedback: { component: 'message', type: 'success', message: '正在前往 Accounts 登录', redirectAfter: 0 } });
		} catch (error) { return apiMessage(c, 502, error instanceof Error ? error.message : 'Accounts 登录初始化失败'); }
	}
	if (c.req.method === 'PUT') return apiMessage(c, 403, '启用 Accounts 登录后不能创建本地用户');
	return baseSign(c, next, {});
};
export default handler;
