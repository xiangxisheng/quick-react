/** 业务站点统一的 Accounts 弹窗登录入口：只在用户点击后调用，本页不会离开。 */
import type { ApiNextAction } from '@shared/types/api-response.mjs';

type PassportSdk = { login: () => Promise<{ next?: ApiNextAction }>; logout: () => Promise<{ next?: ApiNextAction }> };

const loadPassport = async () => {
	const passport = window as Window & { Passport?: PassportSdk };
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
	return passport.Passport;
};

export const loginWithAccountsPopup = async () => (await loadPassport()).login();

/** 由本站后端完成 Accounts 总退出；后续行为完全取自响应里的 next 指令。 */
export const logoutWithAccounts = async () => (await loadPassport()).logout();
