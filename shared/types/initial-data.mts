import type { NavigationItem } from './navigation.mjs';
import type { UserIdentity } from './user.mjs';

export type HeaderAction = {
	key: string;
	label: string;
	action: 'navigate' | 'logout';
};

export type InitialData = {
	apiSuffix: string;
	pageSuffix: string;
	siteNavigation: NavigationItem[];
	footer?: string;
	currentUser?: UserIdentity;
	authActions?: HeaderAction[];
};
