import type { ApiHandler } from '@server/api-router.mjs';
import { normalizeTechStackConfig } from '@server/tech-stack.mjs';
import { apiMessageData, apiResponse } from '@server/api-response.mjs';

const form = {
	description: '配置会作用于后续 HTTP 响应，并保存到服务器配置文件。仅用于兼容性测试、演示或隐藏真实服务实现。',
	submitLabel: '保存配置',
	confirmOnUnchangedSubmit: '当前未修改，仍要提交吗？',
	submitHint: '修改后立即生效',
	initialValues: { nginx: false, phpVersion: '', apiSuffix: '.php', pageSuffix: '.html' },
	fields: [
		{ name: 'nginx', label: 'Nginx', type: 'switch', checkedChildren: '开启', unCheckedChildren: '关闭', extra: '开启后返回 Server: nginx。' },
		{ name: 'phpVersion', label: 'PHP 版本号', type: 'text', extra: '填写例如 8.2.12；留空则不返回 PHP 标识。', placeholder: '例如 8.2.12', maxLength: 32 },
		{ name: 'apiSuffix', label: 'API 路径后缀', type: 'text', extra: '例如 .php、.json；留空则使用无后缀 API 路径。', placeholder: '例如 .php', maxLength: 16 },
		{ name: 'pageSuffix', label: '页面路径后缀', type: 'text', extra: '例如 .html；留空则使用无后缀页面路径。', placeholder: '例如 .html', maxLength: 16 },
	],
};

const handler: ApiHandler = async (c, next) => {
	const store = c.get('configStore');
	if (c.req.method === 'GET') return apiResponse(c, 200, { currentValues: c.get('techStackConfig'), form });
	if (c.req.method === 'PUT') {
		const body = await c.req.json<unknown>().catch(() => ({}));
		const config = normalizeTechStackConfig(body);
		await store.put('tech-stack', config);
		c.set('techStackConfig', config);
		return apiMessageData(c, 200, '保存成功，页面将在 {redirectAfter} 秒后刷新', { currentValues: config }, { component: 'modal', type: 'info', title: '保存结果', refreshNowLabel: '立即刷新', cancelRefreshLabel: '取消', redirectAfter: 3 });
	}
	return next();
};

export default handler;
