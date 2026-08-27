/**
 * 站点数据库目标的结构化配置：表单里按字段填写，存库时仍然拼成 DSN，
 * 运行时解析逻辑保持不变（见 server/app.mts 的 resolveSiteDsn）。
 */
export type DatabaseTargetKind = 'default' | 'sqlite' | 'mysql' | 'postgresql' | 'binding';

export type DatabaseTargetForm = {
	db_kind: DatabaseTargetKind;
	db_file: string;
	db_host: string;
	db_port: string;
	db_name: string;
	db_user: string;
	db_password: string;
	database_binding: string;
};

export const emptyDatabaseTargetForm: DatabaseTargetForm = {
	db_kind: 'default', db_file: '', db_host: '', db_port: '', db_name: '', db_user: '', db_password: '', database_binding: '',
};

const defaultPorts: Record<string, string> = { mysql: '3306', postgresql: '5432' };

/** 把已保存的 DSN 还原成表单字段；密码不回填，留空表示不修改。 */
export const parseDatabaseTarget = (dsn: string, databaseBinding: string): DatabaseTargetForm => {
	if (databaseBinding) return { ...emptyDatabaseTargetForm, db_kind: 'binding', database_binding: databaseBinding };
	const value = dsn.trim();
	if (!value) return { ...emptyDatabaseTargetForm };
	if (value.startsWith('sqlite://')) return { ...emptyDatabaseTargetForm, db_kind: 'sqlite', db_file: value.slice('sqlite://'.length) };
	try {
		const url = new URL(value);
		const kind: DatabaseTargetKind = url.protocol.startsWith('postgres') ? 'postgresql' : 'mysql';
		return {
			...emptyDatabaseTargetForm,
			db_kind: kind,
			db_host: url.hostname,
			db_port: url.port || defaultPorts[kind],
			db_name: decodeURIComponent(url.pathname.replace(/^\//, '')),
			db_user: decodeURIComponent(url.username),
			db_password: '',
		};
	} catch {
		return { ...emptyDatabaseTargetForm };
	}
};

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const bindingPattern = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * 把表单字段拼成 DSN；密码留空时沿用原 DSN 里的密码，便于只改主机或库名。
 * 校验失败抛出面向用户的中文错误。
 */
export const buildDatabaseTarget = (form: Record<string, unknown>, currentDsn = ''): { dsn: string; databaseBinding: string } => {
	const kind = text(form.db_kind) || 'default';
	if (kind === 'default') return { dsn: '', databaseBinding: '' };
	if (kind === 'binding') {
		const binding = text(form.database_binding);
		if (!bindingPattern.test(binding)) return invalid('D1 Binding 名称只能使用大写字母、数字和下划线，且以字母开头');
		return { dsn: '', databaseBinding: binding };
	}
	if (kind === 'sqlite') {
		const file = text(form.db_file);
		if (!file) return invalid('请填写 SQLite 文件路径');
		if (file.includes('\0') || /\s/.test(file)) return invalid('SQLite 文件路径不合法');
		return { dsn: `sqlite://${file}`, databaseBinding: '' };
	}
	if (kind !== 'mysql' && kind !== 'postgresql') return invalid('请选择数据库类型');
	const host = text(form.db_host), name = text(form.db_name), user = text(form.db_user);
	if (!host) return invalid('请填写数据库主机');
	if (!name) return invalid('请填写数据库名');
	if (!user) return invalid('请填写数据库用户名');
	const port = text(form.db_port) || defaultPorts[kind];
	if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) return invalid('数据库端口不合法');
	const password = typeof form.db_password === 'string' && form.db_password !== ''
		? form.db_password
		: currentPassword(currentDsn);
	const url = new URL(`${kind === 'mysql' ? 'mysql' : 'postgresql'}://placeholder`);
	url.hostname = host;
	url.port = port;
	url.username = encodeURIComponent(user);
	if (password) url.password = encodeURIComponent(password);
	url.pathname = `/${encodeURIComponent(name)}`;
	return { dsn: url.toString(), databaseBinding: '' };
};

export class DatabaseTargetError extends Error {}
const invalid = (message: string): never => { throw new DatabaseTargetError(message); };

const currentPassword = (dsn: string) => {
	if (!dsn || dsn.startsWith('sqlite://')) return '';
	try { return decodeURIComponent(new URL(dsn).password); }
	catch { return ''; }
};
