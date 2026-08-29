import { memoryConfigStore, type ConfigStore } from './config-store.mjs';

export type SystemConfig = {
	httpPort: string;
	domain: string;
	publicOrigin: string;
	trustedProxyIps: string;
	mapAllowedIps: string;
	debug: boolean;
};

let defaultConfig: SystemConfig = {
	httpPort: '8088', domain: 'anan.cc', publicOrigin: '',
	trustedProxyIps: '127.0.0.1,::1,::ffff:127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16',
	mapAllowedIps: '127.0.0.1,::1,::ffff:127.0.0.1', debug: false,
};
let config = { ...defaultConfig };
let store: ConfigStore = memoryConfigStore;
let configuredDefaults = '';
let loadedAt = 0;
const cacheTtl = 30_000;

export const configureSystemConfig = (options: { store?: ConfigStore; defaults?: Partial<SystemConfig> }) => {
	const nextStore = options.store ?? memoryConfigStore;
	const nextDefaults = JSON.stringify(options.defaults ?? {});
	if (store === nextStore && configuredDefaults === nextDefaults) return;
	store = nextStore;
	configuredDefaults = nextDefaults;
	defaultConfig = {
		httpPort: '8088', domain: 'anan.cc', publicOrigin: '',
		trustedProxyIps: '127.0.0.1,::1,::ffff:127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16',
		mapAllowedIps: '127.0.0.1,::1,::ffff:127.0.0.1', debug: false,
		...options.defaults,
	};
	config = { ...defaultConfig };
	loadedAt = 0;
};

export const normalizeSystemConfig = (value: unknown, defaults: SystemConfig = defaultConfig): SystemConfig => {
	const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	return {
		httpPort: typeof source.httpPort === 'string' && /^\d{1,5}$/.test(source.httpPort) ? source.httpPort : defaults.httpPort,
		domain: typeof source.domain === 'string' ? source.domain.trim().slice(0, 253) : defaults.domain,
		publicOrigin: typeof source.publicOrigin === 'string' ? source.publicOrigin.trim().slice(0, 512) : defaults.publicOrigin,
		trustedProxyIps: typeof source.trustedProxyIps === 'string' ? source.trustedProxyIps.trim().slice(0, 2048) : defaults.trustedProxyIps,
		mapAllowedIps: typeof source.mapAllowedIps === 'string' ? source.mapAllowedIps.trim().slice(0, 2048) : defaults.mapAllowedIps,
		debug: typeof source.debug === 'boolean' ? source.debug : defaults.debug,
	};
};

export const loadSystemConfigFromStore = async (targetStore: ConfigStore) => normalizeSystemConfig(await targetStore.get('system-config'));

export const loadSystemConfig = async () => {
	if (loadedAt && Date.now() - loadedAt < cacheTtl) return { ...config };
	config = normalizeSystemConfig(await store.get('system-config'));
	loadedAt = Date.now();
	return { ...config };
};

export const getSystemConfig = () => ({ ...config });

export const saveSystemConfig = async (value: unknown) => {
	config = normalizeSystemConfig(value);
	await store.put('system-config', config);
	loadedAt = Date.now();
	return { ...config };
};
