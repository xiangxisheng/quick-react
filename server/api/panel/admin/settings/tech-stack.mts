import type { ApiHandler } from '@server/api-router.mjs';
import { loadTechStackConfig, saveTechStackConfig } from '@server/tech-stack.mjs';

const form = {
	description: '配置会作用于后续 HTTP 响应，并保存到服务器配置文件。仅用于兼容性测试、演示或隐藏真实服务实现。',
	refreshAfterSave: 3,
	submitLabel: '保存配置',
	saveFeedback: { component: 'modal', type: 'info', title: '保存结果', message: '保存成功，页面将在 {refreshAfterSave} 秒后刷新' },
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
	if (c.req.method === 'GET') return c.json({ currentValues: await loadTechStackConfig(), form });
	if (c.req.method === 'PUT') {
		const body = await c.req.json<unknown>().catch(() => ({}));
		const config = await saveTechStackConfig(body);
		return c.json({ currentValues: config });
	}
	return next();
};

export default handler;
