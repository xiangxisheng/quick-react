import type { NavigationItem } from './navigation.mjs';
import type { UserIdentity } from './user.mjs';

export type HeaderAction = {
	key: string;
	label: string;
	action: 'navigate' | 'logout';
	icon?: 'login' | 'register' | 'logout';
};

export type AuthPage = {
	path: string;
	title: string;
	description?: string;
	mode: 'sign' | 'sign-up';
};

export type AuthState = {
	component: 'buttons' | 'dropdown';
	actions: HeaderAction[];
	currentUser?: UserIdentity;
	pages: AuthPage[];
};

export type InitialData = {
	apiSuffix: string;
	pageSuffix: string;
	siteNavigation: NavigationItem[];
	footer?: string;
	auth?: AuthState;
};
