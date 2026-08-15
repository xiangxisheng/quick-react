import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ConfigStore } from './config-store.mjs';

export const createJsonFileStore = (filePath: string): ConfigStore => ({
	get: async () => {
		try {
			return JSON.parse(await readFile(filePath, 'utf8'));
		} catch {
			return undefined;
		}
	},
	put: async (_key, value) => {
		await mkdir(dirname(filePath), { recursive: true });
		const temporaryPath = `${filePath}.${process.pid}.tmp`;
		await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
		await rename(temporaryPath, filePath);
	},
});
