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
const FormPage = (await import('../src/components/panel/FormPage.js')).default;
const DrawerForm = (await import('../src/utils/antd/table_crud/drawer.js')).default;

const response = {
	currentValues: { enabled: false, issuerSource: '__custom__', issuer: '', clientId: '', clientSecret: '' },
	formPage: {
		initialValues: {}, submitLabel: '保存', actions: [{ key: 'test', label: '测试配置' }], fields: [
			{ name: 'issuerSource', label: 'Passport 域名', type: 'select', options: [
				{ value: 'https://passport.test', text: 'Passport (passport.test)', fieldValues: { issuer: 'https://passport.test' } },
				{ value: '__custom__', text: '自定义 Issuer' },
			] },
			{ name: 'issuer', label: 'Accounts Issuer', type: 'text', placeholder: 'https://accounts.example.com', readOnlyWhen: { field: 'issuerSource', optionValues: true } },
		],
	},
};
const requests: Array<{ url: string; init?: RequestInit }> = [];
const commonApi = {
	apiFetch: async (url: string, init?: RequestInit) => {
		requests.push({ url, init });
		return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } });
	},
	modalConfirm: async () => true,
};
const user = userEvent.setup({ document: dom.window.document });

render(React.createElement(FormPage, { commonApi, apiPath: '/api/settings', title: '设置' }));
await waitFor(() => assert.ok(document.querySelector('input[placeholder="https://accounts.example.com"]')));
const issuerInput = document.querySelector('input[placeholder="https://accounts.example.com"]') as HTMLInputElement;
assert.equal(issuerInput.disabled, false, '未选择已知 Passport 域名时 Issuer 应可编辑');
let sourceSelect = screen.getByRole('combobox');
await user.click(sourceSelect);
await user.click(await screen.findByText('Passport (passport.test)'));
await waitFor(() => assert.equal(issuerInput.disabled, true, '选择 Passport 域名后 Issuer 应禁用'));
sourceSelect = screen.getByRole('combobox');
await user.click(sourceSelect);
await user.click(await screen.findByText('自定义 Issuer'));
await waitFor(() => assert.equal(issuerInput.disabled, false, '选择自定义 Issuer 后输入框应解锁'));
await user.clear(issuerInput);
await user.type(issuerInput, 'https://custom.test');
await user.click(screen.getByRole('button', { name: '测试配置' }));
await waitFor(() => assert.ok(requests.some((request) => request.url === '/api/settings?action=test' && JSON.parse(String(request.init?.body)).issuer === 'https://custom.test')));
cleanup();

const columns = [
	{ dataIndex: 'redirect_uri_source', title: '业务站点域名', component: 'select', options: [
		{ value: 'https://site.test/api/accounts/oidc/callback', text: '业务站点 (site.test)', fieldValues: { redirect_uris: 'https://site.test/api/accounts/oidc/callback', backchannel_logout_path: '/api/accounts/oidc/backchannel-logout' } },
		{ value: '__custom__', text: '自定义回调地址', fieldValues: {} },
	] },
	{ dataIndex: 'redirect_uris', title: '回调地址', component: 'textbox', placeholder: '完整 HTTPS 回调地址', readOnlyWhen: { field: 'redirect_uri_source', optionValues: true } },
	{ dataIndex: 'backchannel_logout_path', title: '后端注销路径', component: 'textbox', placeholder: '/api/accounts/oidc/backchannel-logout', readOnlyWhen: { field: 'redirect_uri_source', optionValues: true } },
];
render(React.createElement(DrawerForm, { commonApi, title: 'OIDC 客户端', columns, row: { redirect_uri_source: '__custom__' }, open: true, onClose() {}, onFinish: async () => {}, okText: '确定', cancelText: '取消', loading: false, submitting‌: false }));
await waitFor(() => assert.ok(document.querySelector('input[placeholder="完整 HTTPS 回调地址"]')));
const callbackInput = document.querySelector('input[placeholder="完整 HTTPS 回调地址"]') as HTMLInputElement;
const logoutInput = document.querySelector('input[placeholder="/api/accounts/oidc/backchannel-logout"]') as HTMLInputElement;
assert.equal(callbackInput.disabled, false, '自定义客户端回调地址应可编辑');
sourceSelect = screen.getByRole('combobox');
await user.click(sourceSelect);
await user.click(await screen.findByText('业务站点 (site.test)'));
await waitFor(() => {
	assert.equal(callbackInput.disabled, true, '选择业务站点后回调地址应禁用');
	assert.equal(logoutInput.disabled, true, '选择业务站点后注销路径应禁用');
});
sourceSelect = screen.getByRole('combobox');
await user.click(sourceSelect);
await user.click(await screen.findByText('自定义回调地址'));
await waitFor(() => {
	assert.equal(callbackInput.disabled, false, '选择自定义回调地址后应解锁');
	assert.equal(logoutInput.disabled, false, '选择自定义回调地址后注销路径应解锁');
});
cleanup();
console.log('browser form linkage test passed');
dom.window.close();
