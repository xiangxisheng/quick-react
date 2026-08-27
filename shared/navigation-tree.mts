import type { NavigationItem } from './types/navigation.mjs';

export type NavigationPageDefinition = {
	path: string;
	component: string;
	title: string;
	description: string;
	navigation: NavigationItem[];
	dashboardPath?: string;
	mode?: string;
	apiPath?: string;
	submitMethod?: 'POST' | 'PUT';
	redirectPath?: string;
};

export const stripPageSuffix = (path: string, pageSuffix: string) => (
	pageSuffix && path.endsWith(pageSuffix) ? path.slice(0, -pageSuffix.length) : path
);

const resolveNodeKey = (key: string, parentPath: string) => {
	if (key === '/') return '/';
	if (key.startsWith('/')) return key;
	return `/${[parentPath.replace(/^\//, '').replace(/\/$/, ''), key].filter(Boolean).join('/')}`;
};

export const resolveNavigationPaths = (items: NavigationItem[], parentPath = ''): NavigationItem[] => items.map((item) => {
	const key = String(item.key ?? '');
	const path = resolveNodeKey(key, parentPath);
	return { ...item, key: path, children: item.children ? resolveNavigationPaths(item.children, path) : undefined };
});

export const mergeNavigation = (base: NavigationItem[], overrides: NavigationItem[], parentPath = ''): NavigationItem[] => {
	const remaining = new Map(overrides.map((item) => {
		const key = resolveNodeKey(String(item.key), parentPath);
		return [key, { ...item, key }];
	}));
	const merged = base.map((item) => {
		const key = resolveNodeKey(String(item.key), parentPath);
		const override = remaining.get(key);
		if (!override) return { ...item, key, children: item.children ? mergeNavigation(item.children, [], key) : undefined };
		remaining.delete(key);
		return {
			...item,
			...override,
			key,
			children: mergeNavigation(item.children ?? [], override.children ?? [], key),
		};
	});
	return [...merged, ...remaining.values()].map((item) => ({
		...item,
		children: item.children ? mergeNavigation(item.children, [], String(item.key)) : undefined,
	}));
};

export const filterNavigationByRoles = (items: NavigationItem[], roles: Set<string>): NavigationItem[] => items.flatMap((item) => {
	const requiredRoles = Array.isArray(item.roles) ? item.roles.filter((role): role is string => typeof role === 'string') : ['public'];
	if (!requiredRoles.some((role) => roles.has(role))) return [];
	return [{ ...item, children: item.children ? filterNavigationByRoles(item.children, roles) : undefined }];
});

export const collectPageDefinitions = (
	items: NavigationItem[],
	navigation: NavigationItem[] = items,
	dashboardPath?: string,
): NavigationPageDefinition[] => items.flatMap((item) => {
	const pageNavigation = item.navigationGroup || item.component === 'panel' ? item.children ?? [] : navigation;
	const pageDashboardPath = item.dashboardPath
		?? (item.component === 'panel' ? item.children?.find((child) => child.component === 'dashboard')?.key : dashboardPath);
	const pages = typeof item.component === 'string' && typeof item.title === 'string'
		? [{ path: String(item.key), component: item.component, title: item.title, description: String(item.description ?? ''), navigation: pageNavigation, dashboardPath: pageDashboardPath }]
		: [];
	const children = item.children ? collectPageDefinitions(item.children, pageNavigation, pageDashboardPath) : [];
	return [...pages, ...children];
});

export const uniquePageDefinitions = (items: NavigationItem[]) => [...new Map(
	collectPageDefinitions(items).map((page) => [page.path, page]),
).values()];
