import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

// 站点数据库的结构化配置、连接测试、结构迁移与数据迁移。
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-site-database-'));
process.env.DEFAULT_DATABASE_FILE = join(temporaryDirectory, 'default.sqlite');
process.env.SKIP_SERVER_LISTEN = '1';
const sitePath = '/api/panel/admin/global/site/sites.php';

try {
	const { app } = await import(`../dist/server.mjs?site-database=${Date.now()}`);
	const request = async (path, options = {}) => {
		const headers = new Headers(options.headers);
		if (options.cookie) headers.set('cookie', options.cookie);
		if (options.body !== undefined) headers.set('content-type', 'application/json');
		return app.request(`http://localhost${path}`, { method: options.method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
	};
	assert.equal((await request('/api/sign.php', { method: 'PUT', body: { username: 'site_admin', password: 'test-password-123' } })).status, 201);
	const login = await request('/api/sign.php', { method: 'POST', body: { username: 'site_admin', password: 'test-password-123' } });
	const cookie = login.headers.get('set-cookie')?.split(';')[0];
	const message = async (response) => (await response.json()).feedback.message;

	// 列表：结构化字段 + 只读描述，并且不下发 DSN（避免泄露数据库密码）。
	const list = await (await request(sitePath, { cookie })).json();
	const fields = list.table.columns.map((column) => column.dataIndex);
	assert.ok(['db_kind', 'db_file', 'db_host', 'db_port', 'db_name', 'db_user', 'db_password', 'database_binding'].every((name) => fields.includes(name)));
	assert.equal(fields.includes('dsn'), false, '列定义里不应该再有裸 DSN');
	assert.equal(list.table.columns.find((column) => column.dataIndex === 'db_host').dependsOn, 'db_kind');
	assert.deepEqual(list.table.columns.find((column) => column.dataIndex === 'db_host').parentValues, ['mysql', 'postgresql']);
	assert.deepEqual(list.table.option.actions.row.map((action) => action.key), ['test', 'migrate', 'transfer', 'edit', 'delete']);
	const passportRow = list.table.dataSource.find((row) => row.site_key === 'passport');
	assert.equal(passportRow.dsn, undefined, '不应该把 DSN 返回给前端');
	assert.equal(passportRow.db_kind, 'default');
	assert.equal(passportRow.database_target, '跟随默认库');

	// 非法配置逐项拦截。
	const invalidCases = [
		[{ db_kind: 'sqlite' }, /SQLite 文件路径/],
		[{ db_kind: 'mysql', db_name: 'a', db_user: 'b' }, /数据库主机/],
		[{ db_kind: 'mysql', db_host: 'h', db_user: 'b' }, /数据库名/],
		[{ db_kind: 'mysql', db_host: 'h', db_name: 'a' }, /数据库用户名/],
		[{ db_kind: 'mysql', db_host: 'h', db_name: 'a', db_user: 'b', db_port: '99999' }, /端口/],
		[{ db_kind: 'binding', database_binding: 'bad-name' }, /Binding/],
	];
	for (const [body, pattern] of invalidCases) {
		const rejected = await request(sitePath, { method: 'POST', cookie, body: { site_key: 'tmp_site', name: 'tmp', ...body } });
		assert.equal(rejected.status, 400);
		assert.match(await message(rejected), pattern);
	}

	// 用结构化字段创建 MySQL 站点，密码不回显但保存在 DSN 里。
	assert.equal((await request(sitePath, { method: 'POST', cookie, body: { site_key: 'shop', name: '商城', db_kind: 'mysql', db_host: 'db.internal', db_name: 'shop', db_user: 'shop_user', db_password: 'p@ss word' } })).status, 201);
	const shop = await (await request(`${sitePath}/shop`, { cookie })).json();
	assert.equal(shop.database_target, 'MySQL db.internal:3306/shop');
	assert.equal(shop.db_password, '', '密码不能回显');
	assert.equal(shop.dsn, undefined);
	const stored = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	const storedDsn = stored.prepare("SELECT dsn FROM global_sites WHERE site_key = 'shop'").get().dsn;
	assert.equal(storedDsn, 'mysql://shop_user:p%40ss%20word@db.internal:3306/shop');
	stored.close();

	// 只改端口时保留原密码。
	assert.equal((await request(`${sitePath}/shop`, { method: 'PUT', cookie, body: { db_port: '3307', __changedFields: ['db_port'] } })).status, 200);
	const afterPort = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	assert.equal(afterPort.prepare("SELECT dsn FROM global_sites WHERE site_key = 'shop'").get().dsn, 'mysql://shop_user:p%40ss%20word@db.internal:3307/shop');
	afterPort.close();

	// 连接测试：跟随默认库无需测试；独立 SQLite 能连上并报告表数量。
	assert.match(await message(await request(`${sitePath}/passport?action=test`, { method: 'POST', cookie })), /跟随默认库/);
	assert.equal((await request(sitePath, { method: 'POST', cookie, body: { site_key: 'blog', name: '博客', db_kind: 'sqlite', db_file: join(temporaryDirectory, 'blog.sqlite') } })).status, 201);
	const tested = await request(`${sitePath}/blog?action=test`, { method: 'POST', cookie });
	assert.equal(tested.status, 200);
	assert.match(await message(tested), /连接成功，目标库当前有 \d+ 张表/);

	// 数据迁移：跟随默认库时不需要迁移；SQLite 目标由迁移工具明确拒绝（只支持 MySQL/PostgreSQL）。
	const noTransfer = await request(`${sitePath}/passport?action=transfer`, { method: 'POST', cookie });
	assert.equal(noTransfer.status, 400);
	assert.match(await message(noTransfer), /无需迁移数据/);
	const sqliteTransfer = await request(`${sitePath}/blog?action=transfer`, { method: 'POST', cookie });
	assert.equal(sqliteTransfer.status, 400);
	assert.match(await message(sqliteTransfer), /数据迁移失败：.*MySQL 或 PostgreSQL/);

	// 结构迁移按钮仍然可用。
	assert.equal((await request(`${sitePath}/blog?action=migrate`, { method: 'POST', cookie })).status, 200);
	const migrated = await (await request(`${sitePath}/blog`, { cookie })).json();
	assert.equal(migrated.migration_status, 'ready');
	assert.match(await message(await request(`${sitePath}/blog?action=test`, { method: 'POST', cookie })), /连接成功，目标库当前有 [1-9]\d* 张表/);

	// 不支持的操作要明确拒绝。
	assert.equal((await request(`${sitePath}/blog?action=unknown`, { method: 'POST', cookie })).status, 400);

	console.log('site database test passed');
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
