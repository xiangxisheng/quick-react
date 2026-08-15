import type { ApiHandler } from '@server/api-router.mjs';
import { loadTechStackConfig, saveTechStackConfig } from '@server/tech-stack.mjs';

const settings = {
	description: '配置会作用于后续 HTTP 响应，并保存到服务器配置文件。仅用于兼容性测试、演示或隐藏真实服务实现。',
	initialValues: { nginx: false, phpVersion: '', apiSuffix: '.php', pageSuffix: '.html' },
	fields: [
		{ name: 'nginx', label: 'Nginx', type: 'switch', extra: '开启后返回 Server: nginx。' },
		{ name: 'phpVersion', label: 'PHP 版本号', type: 'text', extra: '填写例如 8.2.12；留空则不返回 PHP 标识。', placeholder: '例如 8.2.12', maxLength: 32 },
		{ name: 'apiSuffix', label: 'API 路径后缀', type: 'text', extra: '例如 .php、.json；留空则使用无后缀 API 路径。', placeholder: '例如 .php', maxLength: 16 },
		{ name: 'pageSuffix', label: '页面路径后缀', type: 'text', extra: '例如 .html；留空则使用无后缀页面路径。', placeholder: '例如 .html', maxLength: 16 },
	],
};

const handler: ApiHandler = async (c, next) => {
	if (c.req.method === 'GET') return c.json({ config: await loadTechStackConfig(), settings });
	if (c.req.method === 'PUT') {
		const body = await c.req.json<unknown>().catch(() => ({}));
		const config = await saveTechStackConfig(body);
		return c.json({ title: '保存成功', message: '技术栈伪装配置已生效', config });
	}
	return next();
};

export default handler;
