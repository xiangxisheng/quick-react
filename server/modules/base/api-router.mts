import type { Context, Next } from 'hono';
import type { AppEnv } from './types.mjs';
import { apiMessage } from './api-response.mjs';

export type ApiNext = () => Promise<Response>;

export type ApiHandler = (
	c: Context<AppEnv>,
	next: ApiNext,
	params: Record<string, string>,
) => Response | Promise<Response | undefined> | undefined;

export type ApiModule = { default?: ApiHandler };
export type SiteApiRoute = { site: string; path: string };

type RouteMatcher = {
	exact: Map<string, Set<string>>;
	byLength: Map<number, SiteApiRoute[]>;
};

const normalizeApiPath = (path: string, apiSuffix: string) => {
	if (!apiSuffix) return path;
	const segments = path.split('/');
	const suffixIndex = segments.findIndex((segment) => segment.endsWith(apiSuffix));
	if (suffixIndex < 0) return path;
	segments[suffixIndex] = segments[suffixIndex].slice(0, -apiSuffix.length);
	return segments.join('/');
};

const createRouteMatcher = (routes: SiteApiRoute[]): RouteMatcher => {
	const exact = new Map<string, Set<string>>();
	const byLength = new Map<number, SiteApiRoute[]>();
	for (const route of routes) {
		if (!route.path.includes('/:')) {
			const sites = exact.get(route.path) ?? new Set<string>();
			sites.add(route.site);
			exact.set(route.path, sites);
		}
		const length = route.path.split('/').filter(Boolean).length;
		const candidates = byLength.get(length) ?? [];
		candidates.push(route);
		byLength.set(length, candidates);
	}
	return { exact, byLength };
};

const matchRoute = (path: string, siteChain: string[], matcher: RouteMatcher) => {
	const exactSites = matcher.exact.get(path);
	if (exactSites) {
		const owner = siteChain.find((site) => exactSites.has(site));
		if (owner) return { owner, routePath: path, params: {} as Record<string, string> };
	}
	const requestSegments = path.split('/').filter(Boolean);
	for (const site of siteChain) {
		for (const route of matcher.byLength.get(requestSegments.length) ?? []) {
			if (route.site !== site || !route.path.includes('/:')) continue;
			const routeSegments = route.path.split('/').filter(Boolean);
			const params: Record<string, string> = {};
			let matches = true;
			for (let index = 0; index < routeSegments.length; index += 1) {
				if (routeSegments[index].startsWith(':')) {
					try { params[routeSegments[index].slice(1)] = decodeURIComponent(requestSegments[index]); }
					catch { matches = false; break; }
				} else if (routeSegments[index] !== requestSegments[index]) {
					matches = false;
					break;
				}
			}
			if (matches) return { owner: site, routePath: route.path, params };
		}
	}
	return undefined;
};

const modulePath = (site: string, routeSegments: string[], depth: number) => (
	depth === 0 ? `routes/${site}/api.mjs` : `routes/${site}/api/${routeSegments.slice(0, depth).join('/')}.mjs`
);

export const createApiGateway = (
	getApiSuffix: (context: Context<AppEnv>) => string,
	options: { routes: SiteApiRoute[]; loadModule: (file: string) => Promise<ApiModule> },
) => {
	const matcher = createRouteMatcher(options.routes);
	return async (c: Context<AppEnv>, _next: Next) => {
		const normalizedPath = normalizeApiPath(c.req.path, getApiSuffix(c));
		const siteChain = c.get('site').codeSiteChain;
		const matched = matchRoute(normalizedPath, siteChain, matcher);
		if (!matched) return apiMessage(c, 404);

		const routeSegments = matched.routePath.split('/').filter(Boolean).slice(1).filter((segment) => !segment.startsWith(':'));
		const files: string[] = [];
		for (let depth = 0; depth <= routeSegments.length; depth += 1) {
			for (const site of siteChain) {
				const file = modulePath(site, routeSegments, depth);
				const module = await options.loadModule(file);
				if (typeof module.default === 'function') {
					files.push(file);
					break;
				}
			}
		}

		const execute = async (index: number): Promise<Response> => {
			const file = files[index];
			const module = await options.loadModule(file);
			if (typeof module.default !== 'function') throw new Error(`API module must export a handler: ${file}`);
			const next = async () => index + 1 < files.length
				? execute(index + 1)
				: apiMessage(c, 500, 'API route did not return a response');
			return (await module.default(c, next, matched.params)) ?? apiMessage(c, 500, 'API route did not return a response');
		};
		return execute(0);
	};
};
