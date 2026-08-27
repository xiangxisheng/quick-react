import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-user-roles-'));
process.env.DEFAULT_DATABASE_FILE = join(temporaryDirectory, 'default.sqlite');
process.env.SKIP_SERVER_LISTEN = '1';

try {
	const { app } = await import(`../dist/server.mjs?user-roles=${Date.now()}`);
	const request = async (path, options = {}) => {
		const headers = new Headers(options.headers);
		if (options.cookie) headers.set('cookie', options.cookie);
		if (options.body !== undefined) headers.set('content-type', 'application/json');
		return app.request(`http://localhost${path}`, {
			method: options.method,
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
	};

	assert.equal((await request('/api/sign.php', { method: 'PUT', body: { username: 'role_admin', password: 'test-password-123' } })).status, 201);
	const login = await request('/api/sign.php', { method: 'POST', body: { username: 'role_admin', password: 'test-password-123' } });
	const cookie = login.headers.get('set-cookie')?.split(';')[0];
	assert.ok(cookie);
	const usersPath = '/api/panel/admin/system/users.php';

	// 角色列是多选下拉，选项来自代码里的角色对照表。
	const list = await (await request(usersPath, { cookie })).json();
	const rolesColumn = list.table.columns.find((column) => column.dataIndex === 'roles');
	assert.equal(rolesColumn.component, 'select');
	assert.equal(rolesColumn.multiple, true);
	assert.deepEqual(rolesColumn.options, [{ value: 'admin', text: '管理员(admin)' }]);

	// 历史 JSON 文本按数组返回，前端可以直接回填多选。
	const bootstrap = list.table.dataSource.find((row) => row.username === 'role_admin');
	assert.deepEqual(bootstrap.roles, ['admin']);

	// 新建用户接受数组角色。
	assert.equal((await request(usersPath, { method: 'POST', cookie, body: { username: 'role_member', password: 'test-password-123', roles: [], status: 'enabled' } })).status, 201);
	const created = (await (await request(usersPath, { cookie })).json()).table.dataSource.find((row) => row.username === 'role_member');
	assert.deepEqual(created.roles, []);
	const detail = await (await request(`${usersPath}/${created.id}`, { cookie })).json();
	assert.deepEqual(detail.roles, []);

	// 隐式角色和未登记角色都不能被分配。
	for (const roles of [['user'], ['public'], ['owner']]) {
		const rejected = await request(usersPath, { method: 'POST', cookie, body: { username: `role_bad_${roles[0]}`, password: 'test-password-123', roles } });
		assert.equal(rejected.status, 400);
		assert.match((await rejected.json()).feedback.message, /不支持的角色/);
	}

	// 编辑时同样校验，并且能把普通用户提升为管理员。
	const rejectedEdit = await request(`${usersPath}/${created.id}`, { method: 'PUT', cookie, body: { roles: ['owner'], __changedFields: ['roles'] } });
	assert.equal(rejectedEdit.status, 400);
	assert.equal((await request(`${usersPath}/${created.id}`, { method: 'PUT', cookie, body: { roles: ['admin'], __changedFields: ['roles'] } })).status, 200);
	const promoted = await (await request(`${usersPath}/${created.id}`, { cookie })).json();
	assert.deepEqual(promoted.roles, ['admin']);

	console.log('user roles test passed');
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
