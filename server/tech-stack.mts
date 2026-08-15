import { memoryConfigStore, type ConfigStore } from './config-store.mjs';

export type TechStackConfig = {
	nginx: boolean;
	phpVersion: string;
	apiSuffix: string;
	pageSuffix: string;
};

let defaultConfig: TechStackConfig = { nginx: false, phpVersion: '', apiSuffix: '.php', pageSuffix: '.html' };
let config: TechStackConfig = { ...defaultConfig };
let store: ConfigStore = memoryConfigStore;
let configuredDefaults = '';
let loadedAt = 0;
const cacheTtl = 30_000;

export const configureTechStack = (options: { store?: ConfigStore; defaults?: Partial<TechStackConfig> }) => {
	const nextStore = options.store ?? memoryConfigStore;
	const nextDefaults = JSON.stringify(options.defaults ?? {});
	if (store === nextStore && configuredDefaults === nextDefaults) return;
	store = nextStore;
	configuredDefaults = nextDefaults;
	defaultConfig = { nginx: false, phpVersion: '', apiSuffix: '.php', pageSuffix: '.html', ...options.defaults };
	config = { ...defaultConfig };
	loadedAt = 0;
};

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
	if (loadedAt && Date.now() - loadedAt < cacheTtl) return { ...config };
	config = normalize(await store.get('tech-stack'));
	loadedAt = Date.now();
	return { ...config };
};

export const getTechStackConfig = () => ({ ...config });

export const saveTechStackConfig = async (value: unknown) => {
	config = normalize(value);
	await store.put('tech-stack', config);
	loadedAt = Date.now();
	return { ...config };
};

export const applyTechStackHeaders = (headers: Headers, requestPath: string) => {
	if (config.nginx) headers.set('Server', 'nginx');
	if (config.phpVersion && (requestPath === '/api' || requestPath.startsWith('/api/'))) {
		headers.set('X-Powered-By', `PHP/${config.phpVersion}`);
	}
};
