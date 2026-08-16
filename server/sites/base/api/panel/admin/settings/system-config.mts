import type { ApiHandler } from '@server/api-router.mjs';
import { normalizeSystemConfig } from '@server/system-config.mjs';

const form = {
	description: '系统运行参数。修改后需要重启服务才能生效。',
	refreshAfterSave: null,
	submitLabel: '保存配置',
	confirmOnUnchangedSubmit: '当前未修改，仍要提交吗？',
	saveFeedback: { component: 'inline', type: 'success', showIcon: true, title: '保存结果', message: '系统配置已保存，重启服务后生效' },
	submitHint: '部分配置需要重启服务后生效',
	initialValues: { httpPort: '8088', domain: 'anan.cc', publicOrigin: '', trustedProxyIps: '', mapAllowedIps: '' },
	fields: [
		{ name: 'httpPort', label: 'HTTP 端口', type: 'text', extra: '修改后需要重启服务，例如 8088。', placeholder: '8088', maxLength: 5 },
		{ name: 'domain', label: '域名', type: 'text', extra: '用于 HTTPS 证书目录和服务域名。', placeholder: 'anan.cc', maxLength: 253 },
		{ name: 'publicOrigin', label: '公共 Origin', type: 'text', extra: '用于 canonical URL，例如 https://example.com；可留空。', placeholder: 'https://example.com', maxLength: 512 },
		{ name: 'trustedProxyIps', label: '可信代理 IP', type: 'text', extra: '逗号分隔；用于解析客户端真实 IP。', placeholder: '127.0.0.1,10.0.0.10', maxLength: 2048 },
		{ name: 'mapAllowedIps', label: 'Source Map 允许 IP', type: 'text', extra: '逗号分隔；用于限制 bundle.js.map 访问。', placeholder: '127.0.0.1', maxLength: 2048 },
	],
};

const handler: ApiHandler = async (c, next) => {
	const store = c.get('configStore');
	if (c.req.method === 'GET') return c.json({ currentValues: c.get('systemConfig'), form });
	if (c.req.method === 'PUT') {
		const body = await c.req.json<unknown>().catch(() => ({}));
		const config = normalizeSystemConfig(body);
		await store.put('system-config', config);
		c.set('systemConfig', config);
		return c.json({ currentValues: config });
	}
	return next();
};

export default handler;
