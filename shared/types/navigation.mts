export type NavigationItem = {
	label: string;
	key: string;
	icon: 'mail' | 'appstore' | string;
	dropdown?: boolean;
	hidden?: boolean;
	component?: string;
	title?: string;
	description?: string;
	navigationGroup?: string;
	dashboardPath?: string;
	roles?: string[];
	managementRoot?: boolean;
	children?: NavigationItem[];
	[key: string]: unknown;
};
