export type PassportLoginOptions = {
	provider?: string;
	/** 站点的登录接口路径，默认取当前页面的 API 后缀配置。 */
	signInPath?: string;
	width?: number;
	height?: number;
};

const currentOrigin = () => window.location.origin;
/** API 后缀由站点配置决定（.php、.html 或空），不能写死。 */
const defaultSignInPath = () => {
	const suffix = (window as Window & { __INITIAL_DATA__?: { apiSuffix?: string } }).__INITIAL_DATA__?.apiSuffix ?? '';
	return `/api/sign${suffix}`;
};
const Passport = {
	async login(options: PassportLoginOptions = {}) {
		const response = await fetch(options.signInPath ?? defaultSignInPath(), { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'login', ...(options.provider ? { provider: options.provider } : {}) }) });
		const result = await response.json();
		if (!response.ok || !result.redirectTo) throw new Error(result?.feedback?.message || 'Passport 登录初始化失败');
		// 登录一律在弹窗里完成，业务页面不会离开。
		const popup = window.open(result.redirectTo, 'passport_login', `width=${options.width ?? 480},height=${options.height ?? 680},resizable=yes,scrollbars=yes`);
		if (!popup) throw new Error('登录窗口被浏览器拦截');
		return new Promise<void>((resolve, reject) => {
			const timer = window.setTimeout(() => { popup.close(); reject(new Error('Passport 登录已超时')); }, 10 * 60 * 1000);
			const listener = (event: MessageEvent) => { if (event.origin !== currentOrigin() || event.data?.source !== 'passport') return; window.clearTimeout(timer); window.removeEventListener('message', listener); popup.close(); event.data.status === 'success' ? resolve() : reject(new Error(event.data.message || 'Passport 登录失败')); };
			window.addEventListener('message', listener);
		});
	},
};

export default Passport;
(window as Window & { Passport?: typeof Passport }).Passport = Passport;
