import type { NavigationItem } from './navigation.mjs';
import type { UserIdentity } from './user.mjs';

export type InitialData = {
	apiSuffix: string;
	pageSuffix: string;
	siteNavigation: NavigationItem[];
	footer?: string;
	currentUser?: UserIdentity;
};
