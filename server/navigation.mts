import type { MenuNode, PageDefinition } from './sites/base/navigation.mjs';
import { workerSiteNavigations } from './.generated/worker-api-registry.mjs';

const resolveNodeKey = (key: string, parentPath: string) => {
	if (key === '/') return '/';
	if (key.startsWith('/')) return key;
	return `/${[parentPath.replace(/^\//, '').replace(/\/$/, ''), key].filter(Boolean).join('/')}`;
};

const mergeNodes = (base: MenuNode[], overrides: MenuNode[], parentPath = ''): MenuNode[] => {
	const remaining = new Map(overrides.map((item) => {
		const key = resolveNodeKey(String(item.key), parentPath);
		return [key, { ...item, key }];
	}));
	const merged = base.map((item) => {
		const key = resolveNodeKey(String(item.key), parentPath);
		const override = remaining.get(key);
		if (!override) return { ...item, key, children: item.children ? mergeNodes(item.children, [], key) : undefined };
		remaining.delete(key);
		return {
			...item,
			...override,
			key,
			children: mergeNodes(item.children ?? [], override.children ?? [], key),
		};
	});
	return [...merged, ...remaining.values()].map((item) => ({
		...item,
		children: item.children ? mergeNodes(item.children, [], String(item.key)) : undefined,
	}));
};

const filterByRoles = (items: MenuNode[], roles: Set<string>): MenuNode[] => items.flatMap((item) => {
	const requiredRoles = Array.isArray(item.roles) ? item.roles.filter((role): role is string => typeof role === 'string') : ['public'];
	if (!requiredRoles.some((role) => roles.has(role))) return [];
	return [{ ...item, children: item.children ? filterByRoles(item.children, roles) : undefined }];
});

export const getSiteNavigation = (siteChain: string[], effectiveRoles: string[] = ['public']) => {
	let navigation: MenuNode[] = [];
	for (const site of [...siteChain].reverse()) {
		navigation = mergeNodes(navigation, workerSiteNavigations[site] ?? []);
	}
	return filterByRoles(navigation, new Set(effectiveRoles));
};

const collectPages = (items: MenuNode[], navigation: MenuNode[] = items, dashboardPath?: string): PageDefinition[] => items.flatMap((item) => {
	const pageNavigation = item.navigationGroup ? item.children ?? [] : navigation;
	const pageDashboardPath = item.component === 'panel'
		? item.children?.find((child) => child.component === 'dashboard')?.key as string | undefined
		: dashboardPath;
	const pages = typeof item.component === 'string' && typeof item.title === 'string'
		? [{ path: String(item.key), component: item.component, title: item.title, description: String(item.description ?? ''), navigation: pageNavigation, dashboardPath: pageDashboardPath }]
		: [];
	const children = item.children ? collectPages(item.children, pageNavigation, pageDashboardPath) : [];
	return [...pages, ...children];
});

export const getPageDefinitions = (menuItems: MenuNode[]) => {
	const pages = collectPages(menuItems);
	return [...new Map(pages.map((page) => [page.path, page])).values()];
};

export const getPageMetadata = (pathname: string, menuItems: MenuNode[], pageSuffix = '.html') => {
	pathname = pageSuffix && pathname.endsWith(pageSuffix) ? pathname.slice(0, -pageSuffix.length) : pathname;
	const page = getPageDefinitions(menuItems).find((item) => item.path === pathname);
	return page
		? { title: page.title, description: page.description }
		: { title: 'Quick React', description: 'Quick React 应用' };
};

export type { MenuNode, PageDefinition };
