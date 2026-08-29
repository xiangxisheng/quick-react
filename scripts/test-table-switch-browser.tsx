import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://site.test/panel/admin/data/rows.html' });
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
const { cleanup, render, screen, waitFor } = await import('@testing-library/react');
const userEvent = (await import('@testing-library/user-event')).default;
const { MemoryRouter } = await import('react-router-dom');
const TableCRUD = (await import('../src/utils/antd/table_crud/index.js')).default;

const queryFields = [{ dataIndex: 'table', label: '数据表', component: 'select', defaultValue: 'table_a', options: [{ value: 'table_a', text: 'table_a' }, { value: 'table_b', text: 'table_b' }] }];
// 第一张表：有行操作和工具栏批量删除。
const tableA = {
	option: { rowKey: 'id', queryFields, actions: { query: [{ key: 'search', label: '搜索' }], toolbar: [{ key: 'delete', label: '删除' }], row: [{ key: 'edit', label: '编辑' }] } },
	columns: [{ dataIndex: 'name', title: '名称', component: 'textbox' }],
	dataSource: [{ id: 'acct_string_id', name: 'A 行' }],
	totalRecords: 1,
};
// 第二张表整体没有 actions：合并语义下会残留上一张表的按钮。行键故意与上一张表相同，用来暴露选中状态残留。
const tableB = {
	option: { rowKey: 'key', queryFields },
	columns: [{ dataIndex: 'title', title: '标题', component: 'textbox' }],
	dataSource: [{ key: 'acct_string_id', title: 'B 行' }],
	totalRecords: 1,
};

const requests: string[] = [];
const commonApi = {
	apiFetch: async (url: string) => {
		requests.push(String(url));
		if (String(url).includes('/acct_string_id')) return new Response(JSON.stringify({ id: 'acct_string_id', name: 'A 行' }), { headers: { 'content-type': 'application/json' } });
		const table = String(url).includes('table=table_b') ? tableB : tableA;
		return new Response(JSON.stringify({ table }), { headers: { 'content-type': 'application/json' } });
	},
	modalConfirm: async () => true,
};

render(React.createElement(MemoryRouter, null, React.createElement(TableCRUD, { commonApi, resourcePath: '/panel/admin/data/rows' })));
await waitFor(() => assert.ok(screen.getByText('A 行')));
assert.ok(screen.getByText('编辑'), '第一张表有行操作');
assert.ok(screen.getByRole('button', { name: /删除/ }), '第一张表有工具栏删除');

// 操作列必须使用同一次后端响应中的字符串 rowKey，不能捕获首次渲染的默认 key。
const user = userEvent.setup({ document: dom.window.document });
await user.click(screen.getByText('编辑'));
await waitFor(() => assert.ok(requests.some((url) => url.includes('/acct_string_id'))));
cleanup();
requests.length = 0;
render(React.createElement(MemoryRouter, null, React.createElement(TableCRUD, { commonApi, resourcePath: '/panel/admin/data/rows' })));
await waitFor(() => assert.ok(screen.getByText('A 行')));

// 选中一行后切换数据表。
const checkbox = document.querySelectorAll('tbody input[type="checkbox"]')[0] as HTMLInputElement;
await user.click(checkbox);
await waitFor(() => assert.equal((screen.getByRole('button', { name: /删除/ }) as HTMLButtonElement).disabled, false, '选中后批量删除可用'));

// 页面上还有分页的页数选择器，查询条件的下拉是第一个。
const select = screen.getAllByRole('combobox')[0];
await user.click(select);
// antd 下拉会渲染多个同名节点，点最后一个真实选项。
await user.click((await screen.findAllByText('table_b')).at(-1)!);
await user.click(screen.getByRole('button', { name: /搜索/ }));
await waitFor(() => assert.ok(screen.getByText('B 行')));

// 切表后：上一张表的行操作和工具栏都不能残留，选中状态也要清空。
assert.equal(screen.queryByText('编辑'), null, '上一张表的行操作不应该残留');
assert.equal(screen.queryByRole('button', { name: /^删除$/ }), null, '上一张表的工具栏不应该残留');
assert.equal(screen.queryByText('A 行'), null);
assert.equal(document.querySelectorAll('tbody input[type="checkbox"]:checked').length, 0, '切表后不应该还有选中行');
assert.equal(screen.queryByRole('button', { name: /搜索/ }), null, '新表没有查询动作时按钮也不应该残留');

console.log('table switch browser test passed');
