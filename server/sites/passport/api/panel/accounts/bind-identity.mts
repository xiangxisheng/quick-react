import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { bindReturnCookie, externalProviders } from '@server/accounts/external.mjs';
import { listAccountIdentities } from '@server/passport/account.mjs';
import { isSecureRequest } from '@server/request-origin.mjs';
import type { FormPageConfig } from '@shared/types/form-page.mjs';

const bindForm = (bound: string[], actions: Array<{ key: string; label: string }>): FormPageConfig => ({
	description: bound.length
		? `当前已绑定：${bound.join('、')}。点击下面的按钮绑定新的第三方账号，绑定后可以用它登录本账号。`
		: '点击下面的按钮绑定第三方账号，绑定后可以用它登录本账号。',
	submitLabel: '刷新',
	actions,
	initialValues: { step: 'check' },
	fields: [{ name: 'step', label: '', type: 'hidden' }],
});

const handler: ApiHandler = async (c, next) => {
	const database = c.get('passportDatabase')!, globalDatabase = c.get('globalDatabase');
	const userId = String(c.get('passportUser')!.id);
	const currentForm = async () => {
		const [identities, providers] = await Promise.all([
			listAccountIdentities(database, globalDatabase, userId),
			externalProviders(database, true),
		]);
		const bound = identities.map((item) => item.provider_label);
		return bindForm(bound, providers.map((provider) => ({ key: `provider:${provider.id}`, label: `绑定${provider.display_name}` })));
	};
	if (c.req.method === 'GET') {
		const formPage = await currentForm();
		return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues });
	}
	if (c.req.method !== 'POST' && c.req.method !== 'PUT') return next();
	const action = c.req.query('action')?.trim();
	if (action?.startsWith('provider:')) {
		const provider = await externalProviders(database, true).then((items) => items.find((item) => item.id === action.slice('provider:'.length)));
		if (!provider) return apiMessage(c, 400, '外部身份源不存在或未启用');
		// 记住返回页面，授权回来后回到身份绑定列表。
		c.header('Set-Cookie', bindReturnCookie(`/panel/accounts/identities${c.get('techStackConfig').pageSuffix}`, isSecureRequest(c)));
		return apiResponse(c, 200, { redirectTo: `/api/accounts/external/${provider.id}`, feedback: { component: 'message' as const, type: 'success' as const, message: `正在前往${provider.display_name}授权`, redirectAfter: 0 } });
	}
	if (action) return apiMessage(c, 400, '不支持的操作');
	const formPage = await currentForm();
	return apiResponse(c, 200, { formPage, currentValues: formPage.initialValues });
};

export default handler;
