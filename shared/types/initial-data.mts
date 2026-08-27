import type { NavigationItem } from './navigation.mjs';
import type { UserIdentity } from './user.mjs';

export type HeaderAction = {
	key: string;
	label: string;
	/** accounts-login：在当前页弹出 Accounts 登录窗口，不跳转也不离开本页。 */
	action: 'navigate' | 'logout' | 'accounts-login';
	icon?: 'login' | 'register' | 'logout' | 'user';
};

export type AuthPage = {
	path: string;
	title: string;
	description?: string;
	mode: 'sign' | 'sign-up';
	apiPath: string;
	submitMethod: 'POST' | 'PUT';
	redirectPath: string;
};

export type AuthState = {
	component: 'buttons' | 'dropdown';
	actions: HeaderAction[];
	currentUser?: UserIdentity;
	pages: AuthPage[];
};

export type PageStatus = {
	path: string;
	status: number;
	title: string;
	description: string;
	actions: HeaderAction[];
};

export type InitialData = {
	apiSuffix: string;
	pageSuffix: string;
	siteName: string;
	siteNavigation: NavigationItem[];
	footer?: string;
	auth?: AuthState;
	pageStatus?: PageStatus;
};
