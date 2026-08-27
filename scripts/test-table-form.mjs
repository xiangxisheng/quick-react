import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'quick-react-table-form-'));
try {
	const result = await build({ entryPoints: [resolve(import.meta.dirname, '../shared/table-form.mts')], bundle: true, format: 'esm', platform: 'node', write: false });
	const file = join(directory, 'table-form.mjs');
	await writeFile(file, result.outputFiles[0].contents);
	const { resolveTableFormColumns } = await import(pathToFileURL(file));
	const linkageResult = await build({ entryPoints: [resolve(import.meta.dirname, '../shared/field-linkage.mts')], bundle: true, format: 'esm', platform: 'node', write: false });
	const linkageFile = join(directory, 'field-linkage.mjs');
	await writeFile(linkageFile, linkageResult.outputFiles[0].contents);
	const { isFieldReadOnly } = await import(pathToFileURL(linkageFile));
	const linkedOptions = [{ value: 'https://passport.test' }, { value: '__custom__' }];
	assert.equal(isFieldReadOnly({ field: 'source', optionValues: true }, undefined, linkedOptions), false);
	assert.equal(isFieldReadOnly({ field: 'source', optionValues: true }, '', linkedOptions), false);
	assert.equal(isFieldReadOnly({ field: 'source', optionValues: true }, 'https://passport.test', linkedOptions), true);
	assert.equal(isFieldReadOnly({ field: 'source', optionValues: true }, '__custom__', linkedOptions), false);
	assert.equal(isFieldReadOnly({ field: 'source', optionValues: true }, 'https://unknown.test', linkedOptions), false);
	const columns = [
		{ dataIndex: 'id', title: 'ID', component: 'textbox', form: { edit: false } },
		{ dataIndex: 'secret', title: '密钥', component: 'textbox', placeholder: '留空不修改', form: { create: { title: '初始密钥', placeholder: '新增必填', rules: [{ required: true, message: '请输入密钥' }] } } },
		{ dataIndex: 'status', title: '状态', component: 'switch' },
	];
	assert.deepEqual(resolveTableFormColumns(columns, 'create'), [
		{ dataIndex: 'id', title: 'ID', component: 'textbox' },
		{ dataIndex: 'secret', title: '初始密钥', component: 'textbox', placeholder: '新增必填', rules: [{ required: true, message: '请输入密钥' }] },
		{ dataIndex: 'status', title: '状态', component: 'switch' },
	]);
	assert.deepEqual(resolveTableFormColumns(columns, 'edit'), [
		{ dataIndex: 'secret', title: '密钥', component: 'textbox', placeholder: '留空不修改' },
		{ dataIndex: 'status', title: '状态', component: 'switch' },
	]);
	console.log('table form mode test passed');
} finally {
	await rm(directory, { recursive: true, force: true });
}
