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
const { MemoryRouter } = await import('react-router-dom');
const StatusPage = (await import('../src/components/common/StatusPage.js')).default;

const requests: string[] = [];
const commonApi = {
	apiFetch: async (url: string) => {
		requests.push(String(url));
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

console.log('page status browser test passed');
