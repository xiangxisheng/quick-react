import { workerApiRoutes, workerSiteNavigations } from './.generated/worker-api-registry.mjs';
import { filterNavigationByRoles, mergeNavigation, stripPageSuffix, uniquePageDefinitions } from '@shared/navigation-tree.mjs';
import type { NavigationItem } from '@shared/types/navigation.mjs';
export type MenuNode = NavigationItem;
export type { NavigationPageDefinition as PageDefinition } from '@shared/navigation-tree.mjs';

/** 身份中心的判定接口：谁实现了 OIDC 授权端点，谁就是 Accounts 身份中心。 */
export const accountsIdentityApi = '/api/oidc/authorize';

/** 继承链里是否有代码站点实现了该接口：用来判断本站具备什么能力，而不是判断它是哪个站点。 */
export const siteProvidesApi = (siteChain: string[], apiPath: string) => (
	workerApiRoutes.some((route) => route.path === apiPath && siteChain.includes(route.site))
);

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
