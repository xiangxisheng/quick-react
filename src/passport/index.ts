export type PassportLoginOptions = {
	provider?: string;
	/** 站点的登录接口路径，默认取当前页面的 API 后缀配置。 */
	signInPath?: string;
	width?: number;
	height?: number;
};

type PassportNextAction = { action: 'reload' } | { action: 'navigate'; path: string };
type PassportLogoutResult = { next?: PassportNextAction; feedback?: { message?: string } };

const currentOrigin = () => window.location.origin;
/** API 后缀由站点配置决定（.php、.html 或空），不能写死。 */
const defaultSignInPath = () => {
	const suffix = (window as Window & { __INITIAL_DATA__?: { apiSuffix?: string } }).__INITIAL_DATA__?.apiSuffix ?? '';
	return `/api/sign${suffix}`;
};
const Passport = {
	async login(options: PassportLoginOptions = {}): Promise<{ next?: PassportNextAction }> {
		const response = await fetch(options.signInPath ?? defaultSignInPath(), { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'login', ...(options.provider ? { provider: options.provider } : {}) }) });
		const result = await response.json();
		if (!response.ok || !result.redirectTo) throw new Error(result?.feedback?.message || 'Passport 登录初始化失败');
		// 登录一律在弹窗里完成，业务页面不会离开。
		const popup = window.open(result.redirectTo, 'passport_login', `width=${options.width ?? 480},height=${options.height ?? 680},resizable=yes,scrollbars=yes`);
		if (!popup) throw new Error('登录窗口被浏览器拦截');
		return new Promise<{ next?: PassportNextAction }>((resolve, reject) => {
			const timer = window.setTimeout(() => { window.clearInterval(closeWatcher); popup.close(); window.removeEventListener('message', listener); reject(new Error('Passport 登录已超时')); }, 10 * 60 * 1000);
			const closeWatcher = window.setInterval(() => {
				if (!popup.closed) return;
				window.clearTimeout(timer); window.clearInterval(closeWatcher); window.removeEventListener('message', listener);
				reject(new Error('Passport 登录窗口已关闭'));
			}, 500);
			const listener = (event: MessageEvent) => { if (event.origin !== currentOrigin() || event.data?.source !== 'passport') return; window.clearTimeout(timer); window.clearInterval(closeWatcher); window.removeEventListener('message', listener); popup.close(); event.data.status === 'success' ? resolve({ next: event.data.next }) : reject(new Error(event.data.message || 'Passport 登录失败')); };
			window.addEventListener('message', listener);
		});
	},
	async logout(options: Pick<PassportLoginOptions, 'signInPath'> = {}): Promise<PassportLogoutResult> {
		const response = await fetch(options.signInPath ?? defaultSignInPath(), { method: 'DELETE', credentials: 'include' });
		const result = await response.json() as PassportLogoutResult;
		if (!response.ok) throw new Error(result.feedback?.message || '退出登录失败');
		return result;
	},
};

export default Passport;
(window as Window & { Passport?: typeof Passport }).Passport = Passport;
