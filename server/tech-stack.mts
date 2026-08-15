import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type TechStackConfig = {
	nginx: boolean;
	phpVersion: string;
	apiSuffix: string;
	pageSuffix: string;
};

const defaultConfig: TechStackConfig = {
	nginx: process.env.MASK_NGINX === '1',
	phpVersion: process.env.MASK_PHP_VERSION || '',
	apiSuffix: process.env.API_ROUTE_SUFFIX ?? '.php',
	pageSuffix: process.env.PAGE_ROUTE_SUFFIX ?? '.html',
};
const configPath = process.env.TECH_STACK_CONFIG_FILE || join(homedir(), '.quick-react', 'tech-stack.json');
let config: TechStackConfig = { ...defaultConfig };

const normalize = (value: unknown): TechStackConfig => ({
	nginx: value && typeof value === 'object' && 'nginx' in value ? Boolean((value as { nginx?: unknown }).nginx) : defaultConfig.nginx,
	phpVersion: (() => {
		const candidate = value && typeof value === 'object' && typeof (value as { phpVersion?: unknown }).phpVersion === 'string'
			? String((value as { phpVersion: string }).phpVersion).trim().slice(0, 32)
			: defaultConfig.phpVersion;
		return /^\d+(?:\.\d+){1,3}$/.test(candidate) ? candidate : '';
	})(),
	apiSuffix: (() => {
		const candidate = value && typeof value === 'object' && typeof (value as { apiSuffix?: unknown }).apiSuffix === 'string'
			? String((value as { apiSuffix: string }).apiSuffix).trim().slice(0, 16)
			: defaultConfig.apiSuffix;
		return /^(?:\.[a-zA-Z0-9_-]+)?$/.test(candidate) ? candidate : defaultConfig.apiSuffix;
	})(),
	pageSuffix: (() => {
		const candidate = value && typeof value === 'object' && typeof (value as { pageSuffix?: unknown }).pageSuffix === 'string'
			? String((value as { pageSuffix: string }).pageSuffix).trim().slice(0, 16)
			: defaultConfig.pageSuffix;
		return /^(?:\.[a-zA-Z0-9_-]+)?$/.test(candidate) ? candidate : defaultConfig.pageSuffix;
	})(),
});

export const loadTechStackConfig = async () => {
	try {
		config = normalize(JSON.parse(await readFile(configPath, 'utf8')));
	} catch {
		config = { ...defaultConfig };
	}
	return { ...config };
};

export const getTechStackConfig = () => ({ ...config });

export const saveTechStackConfig = async (value: unknown) => {
	config = normalize(value);
	await mkdir(dirname(configPath), { recursive: true });
	const temporaryPath = `${configPath}.${process.pid}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
	await rename(temporaryPath, configPath);
	return { ...config };
};

export const applyTechStackHeaders = (headers: Headers, requestPath: string) => {
	if (config.nginx) headers.set('Server', 'nginx');
	if (config.phpVersion && (requestPath === '/api' || requestPath.startsWith('/api/'))) {
		headers.set('X-Powered-By', `PHP/${config.phpVersion}`);
	}
};
