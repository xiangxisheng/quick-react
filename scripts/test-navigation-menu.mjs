import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'quick-react-navigation-menu-'));
try {
	const result = await build({ stdin: { contents: "export * from './shared/navigation-tree.mts';", resolveDir: resolve(import.meta.dirname, '..'), sourcefile: 'navigation-test-entry.mts' }, bundle: true, format: 'esm', platform: 'node', write: false });
	const file = join(directory, 'navigation.mjs');
	await writeFile(file, result.outputFiles[0].contents);
	const { matchNavigationKey, stripPageSuffix } = await import(pathToFileURL(file));

	const keys = ['/', '/panel/admin', '/about', '/panel/me', '/panel/accounts'];
	// 首页只匹配自身，不匹配其它路径。
	assert.equal(matchNavigationKey(keys, '/'), '/');
	assert.equal(matchNavigationKey(keys, '/about'), '/about');
	// 子路径高亮所属的顶层菜单，并且取最长匹配。
	assert.equal(matchNavigationKey(keys, '/panel/admin/system/users'), '/panel/admin');
	assert.equal(matchNavigationKey(keys, '/panel/accounts/profile'), '/panel/accounts');
	// 不属于任何菜单的页面不高亮。
	assert.equal(matchNavigationKey(keys, '/accounts/sign'), '');
	assert.equal(matchNavigationKey(keys, '/panel'), '');
	assert.equal(matchNavigationKey(keys, '/aboutus'), '');
	assert.equal(matchNavigationKey(keys, '/no-such-page'), '');
	// 前缀相同但不是同一段路径的不算匹配。
	assert.equal(matchNavigationKey(['/panel/admin'], '/panel/administrator'), '');
	assert.equal(matchNavigationKey([''], '/'), '');

	assert.equal(stripPageSuffix('/panel/accounts/profile.html', '.html'), '/panel/accounts/profile');
	assert.equal(stripPageSuffix('/', '.html'), '/');
	assert.equal(stripPageSuffix('/panel/admin', ''), '/panel/admin');

	console.log('navigation menu test passed');
} finally {
	await rm(directory, { recursive: true, force: true });
}
