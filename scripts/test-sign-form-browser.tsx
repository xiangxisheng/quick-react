import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://accounts.test/accounts/sign.html' });
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
const FormPage = (await import('../src/components/panel/FormPage.js')).default;

const signInForm = {
	description: '输入邮箱后点下一步',
	submitLabel: '下一步',
	externalLogins: [{ key: 'wechat', label: '微信' }, { key: 'telegram', label: 'Telegram' }],
	initialValues: { step: 'email', email: '' },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'email', label: '邮箱', rules: [{ required: true, message: '请输入邮箱' }] },
	],
};
const passwordForm = {
	description: '输入密码登录',
	submitLabel: '登录',
	actions: [{ key: 'forgot_password', label: '忘记密码' }],
	initialValues: { step: 'password', email: 'user@example.com', password: '' },
	fields: [
		{ name: 'step', label: '', type: 'hidden' },
		{ name: 'email', label: '', type: 'hidden' },
		{ name: 'password', label: '密码', type: 'password' },
	],
};

const requests: Array<{ url: string; method?: string }> = [];
let nextResponse: unknown = { formPage: signInForm, currentValues: signInForm.initialValues };
const commonApi = {
	apiFetch: async (url: string, init?: RequestInit) => {
		requests.push({ url: String(url), method: init?.method });
		return new Response(JSON.stringify(nextResponse), { headers: { 'content-type': 'application/json' } });
	},
	modalConfirm: async () => true,
};

// 登录页的 apiPath 自带查询串，action 必须按 URL 规则追加。
render(React.createElement(FormPage, { commonApi, apiPath: '/api/accounts/sign.php?mode=sign', title: '登录' }));
await waitFor(() => assert.ok(screen.getByText('输入邮箱后点下一步')));
assert.deepEqual(requests.map((item) => item.url), ['/api/accounts/sign.php?mode=sign']);

// 第三方登录渲染成图标链接，不是表单按钮。
assert.ok(screen.getByText('微信'));
assert.ok(screen.getByText('Telegram'));
assert.equal(screen.queryByRole('button', { name: /微信/ }), null, '第三方入口不应该是按钮');

// 空表单不显示清空和还原按钮。
assert.equal(screen.queryByTitle('清空'), null);
assert.equal(screen.queryByTitle('还原'), null);

const user = userEvent.setup({ document: dom.window.document });
nextResponse = { redirectTo: '/api/accounts/external/wechat', feedback: { component: 'message', type: 'success', message: '正在前往微信', redirectAfter: 0 } };
await user.click(screen.getByText('微信'));
await waitFor(() => assert.equal(requests.length, 2));
assert.equal(requests[1].url, '/api/accounts/sign.php?mode=sign&action=provider%3Awechat');
assert.equal(requests[1].method, 'POST');
cleanup();

// 有初始值的字段仍然保留清空和还原。
requests.length = 0;
nextResponse = { formPage: passwordForm, currentValues: passwordForm.initialValues };
render(React.createElement(FormPage, { commonApi, apiPath: '/api/accounts/sign.php?mode=sign', title: '登录' }));
await waitFor(() => assert.ok(screen.getByText('输入密码登录')));
assert.equal(screen.queryByTitle('清空'), null, '空密码字段不显示清空');
nextResponse = { formPage: signInForm, currentValues: signInForm.initialValues };
await user.click(screen.getByRole('button', { name: '忘记密码' }));
await waitFor(() => assert.equal(requests.length, 2));
assert.equal(requests[1].url, '/api/accounts/sign.php?mode=sign&action=forgot_password');
// 动作返回的新表单会替换当前表单。
await waitFor(() => assert.ok(screen.getByText('输入邮箱后点下一步')));

console.log('sign form browser test passed');
