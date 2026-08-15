import type { ApiHandler } from '@server/api-router.mjs';
import { loadTechStackConfig, saveTechStackConfig } from '@server/tech-stack.mjs';

const handler: ApiHandler = async (c, next) => {
	if (c.req.method === 'GET') return c.json({ config: await loadTechStackConfig() });
	if (c.req.method === 'PUT') {
		const body = await c.req.json<unknown>().catch(() => ({}));
		const config = await saveTechStackConfig(body);
		return c.json({ title: '保存成功', message: '技术栈伪装配置已生效', config });
	}
	return next();
};

export default handler;
