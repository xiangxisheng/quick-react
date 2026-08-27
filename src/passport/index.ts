export type PassportLoginOptions = {
	clientId: string;
	provider?: string;
	mode?: 'popup' | 'redirect';
	width?: number;
	height?: number;
};

const currentOrigin = () => window.location.origin;
const authorizeUrl = (clientId: string, provider?: string) => {
	const url = new URL('/api/accounts/oidc/authorize', currentOrigin());
	url.searchParams.set('client_id', clientId);
	url.searchParams.set('redirect_uri', `${currentOrigin()}/api/accounts/oidc/callback`);
	if (provider) url.searchParams.set('provider', provider);
	return url.toString();
};

const Passport = {
	login(options: PassportLoginOptions) {
		const url = authorizeUrl(options.clientId, options.provider);
		if (options.mode === 'redirect') { window.location.assign(url); return Promise.resolve(); }
		return new Promise<void>((resolve, reject) => {
			const popup = window.open(url, 'passport_login', `width=${options.width ?? 480},height=${options.height ?? 680},resizable=yes,scrollbars=yes`);
			if (!popup) { reject(new Error('登录窗口被浏览器拦截')); return; }
			const listener = (event: MessageEvent) => {
				if (event.origin !== currentOrigin() || event.data?.source !== 'passport') return;
				window.removeEventListener('message', listener);
				popup.close();
				event.data.status === 'success' ? resolve() : reject(new Error(event.data.message || 'Passport 登录失败'));
			};
			window.addEventListener('message', listener);
		});
	},
	async getSession() {
		const response = await fetch('/api/accounts/session', { credentials: 'include' });
		return response.ok ? response.json() : null;
	},
	async logout() {
		await fetch('/api/accounts/logout', { method: 'POST', credentials: 'include' });
	},
};

export default Passport;
(window as Window & { Passport?: typeof Passport }).Passport = Passport;
