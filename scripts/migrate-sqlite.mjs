import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = await mkdtemp(join(import.meta.dirname, '.database-transfer-'));
try {
	const result = await build({ entryPoints: [resolve(import.meta.dirname, '../server/database/transfer-cli.mts')], bundle: true, format: 'esm', packages: 'external', platform: 'node', write: false });
	const output = join(directory, 'transfer-cli.mjs');
	await writeFile(output, result.outputFiles[0].contents);
	await import(pathToFileURL(output));
} finally {
	await rm(directory, { recursive: true, force: true });
}
