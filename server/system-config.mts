import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type SystemConfig = {
	httpPort: string;
	domain: string;
	publicOrigin: string;
	trustedProxyIps: string;
	mapAllowedIps: string;
};

const defaultConfig: SystemConfig = {
	httpPort: process.env.HTTP_PORT || '8088',
	domain: process.env.DOMAIN || 'anan.cc',
	publicOrigin: process.env.PUBLIC_ORIGIN || '',
	trustedProxyIps: process.env.TRUSTED_PROXY_IPS || '127.0.0.1,::1,::ffff:127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16',
	mapAllowedIps: process.env.MAP_ALLOWED_IPS || '127.0.0.1,::1,::ffff:127.0.0.1',
};
const configPath = process.env.SYSTEM_CONFIG_FILE || join(homedir(), '.quick-react', 'system-config.json');
let config = { ...defaultConfig };

const normalize = (value: unknown): SystemConfig => {
	const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	return {
		httpPort: typeof source.httpPort === 'string' && /^\d{1,5}$/.test(source.httpPort) ? source.httpPort : defaultConfig.httpPort,
		domain: typeof source.domain === 'string' ? source.domain.trim().slice(0, 253) : defaultConfig.domain,
		publicOrigin: typeof source.publicOrigin === 'string' ? source.publicOrigin.trim().slice(0, 512) : defaultConfig.publicOrigin,
		trustedProxyIps: typeof source.trustedProxyIps === 'string' ? source.trustedProxyIps.trim().slice(0, 2048) : defaultConfig.trustedProxyIps,
		mapAllowedIps: typeof source.mapAllowedIps === 'string' ? source.mapAllowedIps.trim().slice(0, 2048) : defaultConfig.mapAllowedIps,
	};
};

export const loadSystemConfig = async () => {
	try {
		config = normalize(JSON.parse(await readFile(configPath, 'utf8')));
	} catch {
		config = { ...defaultConfig };
	}
	return { ...config };
};

export const saveSystemConfig = async (value: unknown) => {
	config = normalize(value);
	await mkdir(dirname(configPath), { recursive: true });
	const temporaryPath = `${configPath}.${process.pid}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
	await rename(temporaryPath, configPath);
	return { ...config };
};

