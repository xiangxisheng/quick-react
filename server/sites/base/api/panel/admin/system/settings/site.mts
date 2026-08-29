import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessageData, apiResponse } from '@server/api-response.mjs';
import { mergeChangedFields } from '@server/changed-fields.mjs';
import { normalizeSiteSettings } from '@server/site-settings.mjs';
import type { FormPageConfig } from '@shared/types/form-page.mjs';

const formPage = {
	description: '配置当前站点的联系信息和退出登录入口。',
	submitLabel: '保存配置',
	initialValues: { contactEmail: '', logoutLocalEnabled: true, logoutPassportEnabled: true, logoutAllEnabled: true },
	fields: [
		{ name: 'contactEmail', label: '联系邮箱', type: 'text', placeholder: 'support@example.com', maxLength: 254 },
		{ name: 'logoutLocalEnabled', label: '启用“退出本站”', type: 'switch' },
		{ name: 'logoutPassportEnabled', label: '启用“退出 Passport”', type: 'switch' },
		{ name: 'logoutAllEnabled', label: '启用“退出登录”', type: 'switch' },
	],
} satisfies FormPageConfig;

const handler: ApiHandler = async (c, next) => {
	if (c.req.method === 'GET') return apiResponse(c, 200, { currentValues: c.get('siteSettings'), formPage });
	if (c.req.method === 'PUT') {
		const body = await c.req.json<unknown>().catch(() => ({}));
		const settings = normalizeSiteSettings(mergeChangedFields(c.get('siteSettings'), body, ['contactEmail', 'logoutLocalEnabled', 'logoutPassportEnabled', 'logoutAllEnabled']));
		await c.get('configStore').put('site-settings', settings);
		c.set('siteSettings', settings);
		return apiMessageData(c, 200, '站点设置已保存', { currentValues: settings }, { component: 'inline', showIcon: true, title: '保存结果' });
	}
	return next();
};
export default handler;
