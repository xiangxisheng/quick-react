/** 业务站点统一的 Accounts 弹窗登录入口：只在用户点击后调用，本页不会离开。 */
export const loginWithAccountsPopup = async () => {
	const passport = window as Window & { Passport?: { login: () => Promise<void> } };
	if (!passport.Passport) {
		await new Promise<void>((resolve, reject) => {
			const script = document.createElement('script');
			script.src = '/passport.js';
			script.onload = () => resolve();
			script.onerror = () => reject(new Error('Passport SDK 加载失败'));
			document.head.appendChild(script);
		});
	}
	if (!passport.Passport) throw new Error('Passport SDK 加载失败');
	await passport.Passport.login();
};
