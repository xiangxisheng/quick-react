import { workerSiteNavigations } from './.generated/worker-api-registry.mjs';
import { filterNavigationByRoles, mergeNavigation, stripPageSuffix, uniquePageDefinitions } from '@shared/navigation-tree.mjs';
import type { NavigationItem } from '@shared/types/navigation.mjs';
export type MenuNode = NavigationItem;
export type { NavigationPageDefinition as PageDefinition } from '@shared/navigation-tree.mjs';

export const getFullSiteNavigation = (siteChain: string[]) => {
	let navigation: MenuNode[] = [];
	for (const site of [...siteChain].reverse()) {
		navigation = mergeNavigation(navigation, workerSiteNavigations[site] ?? []);
	}
	return navigation;
};

export const getSiteNavigation = (siteChain: string[], effectiveRoles: string[] = ['public']) => (
	filterNavigationByRoles(getFullSiteNavigation(siteChain), new Set(effectiveRoles))
);

export const getPageDefinitions = (menuItems: MenuNode[]) => {
	return uniquePageDefinitions(menuItems);
};

export const getPageMetadata = (pathname: string, menuItems: MenuNode[], pageSuffix = '.html') => {
	pathname = stripPageSuffix(pathname, pageSuffix);
	const page = getPageDefinitions(menuItems).find((item) => item.path === pathname);
	return page
		? { title: page.title, description: page.description }
		: { title: 'Quick React', description: 'Quick React 应用' };
};
