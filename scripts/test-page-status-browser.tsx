import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://site.test/' });
Object.assign(globalThis, {
	window: dom.window,
	document: dom.window.document,
	HTMLElement: dom.window.HTMLElement,
	HTMLBodyElement: dom.window.HTMLBodyElement,
	HTMLHtmlElement: dom.window.HTMLHtmlElement,
	Element: dom.window.Element,
	SVGElement: dom.window.SVGElement,
	ShadowRoot: dom.window.ShadowRoot,
	Node: dom.window.Node,
	getComputedStyle: (element: Element) => dom.window.getComputedStyle(element),
	MutationObserver: dom.window.MutationObserver,
});
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
Object.assign(dom.window.HTMLElement.prototype, { attachEvent() {}, detachEvent() {} });
Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) });
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as typeof ResizeObserver;

const React = await import('react');
const { render, screen, waitFor, cleanup } = await import('@testing-library/react');
const userEvent = (await import('@testing-library/user-event')).default;
const { MemoryRouter } = await import('react-router-dom');
const StatusPage = (await import('../src/components/common/StatusPage.js')).default;
const AuthActions = (await import('../src/components/AuthActions.js')).default;

const requests: string[] = [];
const commonApi = {
	apiFetch: async (url: string) => {
		requests.push(String(url));
		if (String(url) === '/api/sign.php') return new Response(JSON.stringify({
			formPage: {
				description: '使用本站账号登录', submitLabel: '登录', initialValues: { username: '', password: '', remember: false },
				fields: [
					{ name: 'username', label: '用户名', rules: [{ required: true, message: '请输入用户名' }] },
					{ name: 'password', label: '密码', type: 'password', rules: [{ required: true, message: '请输入密码' }] },
				],
			},
		}), { headers: { 'content-type': 'application/json' } });
		return new Response(JSON.stringify({
			pageStatus: { path: '/panel/admin.html', status: 403, title: '无权访问', description: '当前账号没有访问权限', actions: [{ key: '/', label: '返回首页', action: 'navigate' }] },
		}), { headers: { 'content-type': 'application/json' } });
	},
};

const renderStatusPage = (path: string, pageStatus?: unknown) => render(
	React.createElement(MemoryRouter, { initialEntries: [path] },
		React.createElement(StatusPage, { commonApi, apiSuffix: '.php', pageSuffix: '.html', pageStatus })),
);

// 服务端渲染的提示直接展示，不再请求接口。
renderStatusPage('/no-such-page.html', {
	path: '/no-such-page.html', status: 404, title: '页面不存在', description: '没有找到路径 /no-such-page.html',
	actions: [{ key: '/', label: '返回首页', action: 'navigate' }],
});
await waitFor(() => assert.ok(screen.getByText('页面不存在')));
assert.ok(screen.getByText('没有找到路径 /no-such-page.html'));
assert.ok(screen.getByRole('button', { name: /返回首页/ }));
assert.deepEqual(requests, [], '已有服务端提示时不应请求页面状态接口');
cleanup();

// 前端路由跳转到未注册路径时向后端查询提示。
renderStatusPage('/panel/admin.html', {
	path: '/other.html', status: 404, title: '页面不存在', description: '没有找到路径 /other.html',
	actions: [{ key: '/', label: '返回首页', action: 'navigate' }],
});
await waitFor(() => assert.ok(screen.getByText('无权访问')));
assert.deepEqual(requests, ['/api/page-status.php?path=%2Fpanel%2Fadmin.html']);
assert.ok(screen.getByText('当前账号没有访问权限'));
cleanup();

// 本地登录 action 在当前页面打开后端表单，不再跳转 /sign.html。
requests.length = 0;
renderStatusPage('/panel/admin.html', {
	path: '/panel/admin.html', status: 401, title: '请先登录', description: '登录后才能继续',
	actions: [{ key: '/sign', label: '登录', action: 'local-login', icon: 'login' }],
});
screen.getByRole('button', { name: /登录/ }).click();
await waitFor(() => assert.ok(screen.getByText('使用本站账号登录')));
assert.ok(screen.getByRole('dialog'));
assert.deepEqual(requests, ['/api/sign.php']);
cleanup();

// 退出行为由后端响应决定；组件不自行拼接登录状态或跳转目标。
let logoutCalls = 0;
(dom.window as unknown as { Passport: { login: () => Promise<void>; logout: () => Promise<unknown> } }).Passport = {
	login: async () => undefined,
	logout: async () => {
		logoutCalls += 1;
		return {};
	},
};
render(React.createElement(MemoryRouter, {}, React.createElement(AuthActions, {
	auth: { component: 'dropdown', currentUser: { id: 1, username: 'logout_user' }, actions: [{ key: '/sign', label: '退出登录', action: 'logout', icon: 'logout' }], pages: [] },
	commonApi, apiSuffix: '.php', pageSuffix: '.html',
})));
const user = userEvent.setup({ document: dom.window.document });
await user.click(screen.getByRole('button', { name: /logout_user/ }));
await user.click(await screen.findByText('退出登录'));
await waitFor(() => assert.equal(logoutCalls, 1));
assert.equal(logoutCalls, 1);
cleanup();

console.log('page status browser test passed');
