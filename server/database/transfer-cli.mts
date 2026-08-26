import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createMysqlAdapter } from './mysql.mjs';
import { createPostgresqlAdapter } from './postgresql.mjs';
import { createSqliteAdapter } from './sqlite.mjs';
import { migrateDatabase } from './migrate.mjs';
import { portableTableGroups, transferPortableDatabase, type PortableTableGroup } from './transfer.mjs';

const values = new Map<string, string>();
const allowedArguments = new Set(['help', 'source', 'target', 'groups']);
for (let index = 2; index < process.argv.length; index += 1) {
	const argument = process.argv[index];
	if (!argument.startsWith('--')) throw new Error(`无法识别的参数：${argument}`);
	const [inlineKey, inlineValue] = argument.slice(2).split('=', 2);
	if (!allowedArguments.has(inlineKey)) throw new Error(`无法识别的参数：--${inlineKey}`);
	if (inlineKey === 'help') {
		values.set('help', 'true');
		continue;
	}
	const value = inlineValue ?? process.argv[++index];
	if (!value || value.startsWith('--')) throw new Error(`参数 --${inlineKey} 缺少值`);
	values.set(inlineKey, value);
}

if (values.has('help') || !values.has('source') || !values.has('target')) {
	console.log('用法：npm run migrate:sqlite -- --source <sqlite文件> --target <mysql://或postgresql://DSN> [--groups global,base,passport]');
	if (!values.has('source') || !values.has('target')) process.exitCode = values.has('help') ? 0 : 1;
} else {
	const sourceFile = resolve(values.get('source') as string);
	const sourceStatus = await stat(sourceFile).catch(() => undefined);
	if (!sourceStatus?.isFile()) throw new Error(`SQLite 源文件不存在：${sourceFile}`);
	const targetDsn = values.get('target') as string;
	const requestedGroups = (values.get('groups') ?? 'base,passport').split(',').map((group) => group.trim()).filter(Boolean);
	if (!requestedGroups.length) throw new Error('至少选择一个迁移组');
	const groups: PortableTableGroup[] = [];
	for (const group of new Set(requestedGroups)) {
		if (!(group in portableTableGroups)) throw new Error(`不支持的迁移组：${group}`);
		groups.push(group as PortableTableGroup);
	}
	const target = targetDsn.startsWith('mysql://') || targetDsn.startsWith('mysql2://')
		? createMysqlAdapter(targetDsn.replace(/^mysql2:/, 'mysql:'))
		: targetDsn.startsWith('postgresql://') || targetDsn.startsWith('postgres://')
			? createPostgresqlAdapter(targetDsn)
			: undefined;
	if (!target) throw new Error('目标 DSN 必须使用 mysql:// 或 postgresql://');
	const source = createSqliteAdapter(sourceFile, { readBigInts: true });
	try {
		await migrateDatabase(target, resolve('migrations'), groups);
		const result = await transferPortableDatabase(source, target, groups, ({ table, rows }) => console.log(`${table}: ${rows} 行`));
		console.log(`迁移完成：${result.length} 张表，${result.reduce((sum, table) => sum + table.rows, 0)} 行`);
	} finally {
		source.close();
		await target.close?.();
	}
}
