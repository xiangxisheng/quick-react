import type { ConfigStore } from './config-store.mjs';

export type SiteSettings = { contactEmail: string; footer: string; logoutLocalEnabled: boolean; logoutPassportEnabled: boolean; logoutAllEnabled: boolean };
export const defaultSiteSettings: SiteSettings = { contactEmail: '', footer: `Ant Design ©${new Date().getFullYear()} Created by Ant UED`, logoutLocalEnabled: true, logoutPassportEnabled: true, logoutAllEnabled: true };
export const normalizeSiteSettings = (value: unknown): SiteSettings => {
	const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	return {
		contactEmail: typeof source.contactEmail === 'string' ? source.contactEmail.trim().slice(0, 254) : defaultSiteSettings.contactEmail,
		footer: typeof source.footer === 'string' ? source.footer.trim().slice(0, 512) : defaultSiteSettings.footer,
		logoutLocalEnabled: typeof source.logoutLocalEnabled === 'boolean' ? source.logoutLocalEnabled : true,
		logoutPassportEnabled: typeof source.logoutPassportEnabled === 'boolean' ? source.logoutPassportEnabled : true,
		logoutAllEnabled: typeof source.logoutAllEnabled === 'boolean' ? source.logoutAllEnabled : true,
	};
};
export const loadSiteSettings = async (store: ConfigStore) => normalizeSiteSettings(await store.get('site-settings'));
