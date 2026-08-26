import type { SqlDialect } from './sql.mjs';

export type CompiledStatement = {
	query: string;
	values: (values: unknown[]) => unknown[];
};

export const compileSqlPlaceholders = (query: string, dialect: SqlDialect): CompiledStatement => {
	const indexes: number[] = [];
	const compiled = query.replace(/\?(\d+)/g, (_placeholder, rawIndex: string) => {
		const index = Number(rawIndex);
		if (!Number.isInteger(index) || index < 1) throw new Error(`Invalid SQL placeholder: ?${rawIndex}`);
		indexes.push(index - 1);
		return dialect === 'postgresql' ? `$${index}` : '?';
	});
	if (!indexes.length) return { query, values: (values) => values };
	if (dialect === 'postgresql') return { query: compiled, values: (values) => values };
	return { query: compiled, values: (values) => indexes.map((index) => values[index]) };
};
