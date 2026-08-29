import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiMessageData, apiResponse } from '@server/modules/base/api-response.mjs';
import { mergeChangedFields } from '@server/modules/base/changed-fields.mjs';
import { defaultSiteSettings, normalizeSiteSettings } from '@server/modules/base/site-settings.mjs';
import type { FormPageConfig } from '@shared/types/form-page.mjs';

const formPage = {
	description: '配置当前站点的联系信息、页脚和退出登录入口。',
	submitLabel: '保存配置',
	initialValues: { contactEmail: '', footer: defaultSiteSettings.footer, logoutLocalEnabled: true, logoutPassportEnabled: true, logoutAllEnabled: true },
	fields: [
		{ name: 'contactEmail', label: '联系邮箱', type: 'text', placeholder: 'support@example.com', maxLength: 254 },
		{ name: 'footer', label: '页脚内容', type: 'text', placeholder: 'Ant Design ©2026 Created by Ant UED', maxLength: 512, defaultValue: defaultSiteSettings.footer },
		{ name: 'logoutLocalEnabled', label: '启用“退出本站”', type: 'switch', defaultValue: true },
		{ name: 'logoutPassportEnabled', label: '启用“退出 Passport”', type: 'switch', defaultValue: true },
		{ name: 'logoutAllEnabled', label: '启用“退出登录”', type: 'switch', defaultValue: true },
	],
} satisfies FormPageConfig;

const handler: ApiHandler = async (c, next) => {
	if (c.req.method === 'GET') return apiResponse(c, 200, { currentValues: c.get('siteSettings'), formPage });
	if (c.req.method === 'PUT') {
		const body = await c.req.json<unknown>().catch(() => ({}));
		const settings = normalizeSiteSettings(mergeChangedFields(c.get('siteSettings'), body, ['contactEmail', 'footer', 'logoutLocalEnabled', 'logoutPassportEnabled', 'logoutAllEnabled']));
		await c.get('configStore').put('site-settings', settings);
		c.set('siteSettings', settings);
		return apiMessageData(c, 200, '站点设置已保存', { currentValues: settings }, { component: 'inline', showIcon: true, title: '保存结果' });
	}
	return next();
};
export default handler;
