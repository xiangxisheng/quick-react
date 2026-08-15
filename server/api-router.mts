import type { Context, Next } from 'hono';
import type { AppEnv } from './types.mjs';

export type ApiNext = () => Promise<Response>;

export type ApiHandler = (
	c: Context<AppEnv>,
	next: ApiNext,
	params: Record<string, string>,
) => Response | Promise<Response | undefined> | undefined;

export type ApiModule = {
	default?: ApiHandler;
};

export type ApiRoute = {
	path: string;
	files: string[];
};

type ApiManifest = {
	routes: ApiRoute[];
};

let manifest: ApiManifest | undefined;
const loadManifest = async () => {
	manifest ??= (await import(new URL('./api-manifest.mjs', import.meta.url).href) as { default: ApiManifest }).default;
	return manifest;
};

const normalizeApiPath = (path: string, apiSuffix: string) => {
	if (!apiSuffix) return path;
	const segments = path.split('/');
	const suffixIndex = segments.findIndex((segment) => segment.endsWith(apiSuffix));
	if (suffixIndex < 0) return path;
	segments[suffixIndex] = segments[suffixIndex].slice(0, -apiSuffix.length);
	return segments.join('/');
};

type RouteMatcher = {
	exact: Map<string, ApiRoute>;
	byLength: Map<number, ApiRoute[]>;
};

const createRouteMatcher = (routes: ApiRoute[]): RouteMatcher => {
	const exact = new Map<string, ApiRoute>();
	const byLength = new Map<number, ApiRoute[]>();
	for (const route of routes) {
		if (!route.path.includes('/:')) exact.set(route.path, route);
		const length = route.path.split('/').filter(Boolean).length;
		const candidates = byLength.get(length) ?? [];
		candidates.push(route);
		byLength.set(length, candidates);
	}
	return { exact, byLength };
};

const findRoute = (path: string, apiSuffix: string, matcher: RouteMatcher) => {
	const normalizedPath = normalizeApiPath(path, apiSuffix);
	const exactRoute = matcher.exact.get(normalizedPath);
	if (exactRoute) return { route: exactRoute, params: {} };

	const requestSegments = normalizedPath.split('/').filter(Boolean);
	for (const route of matcher.byLength.get(requestSegments.length) ?? []) {
		const routeSegments = route.path.split('/').filter(Boolean);
		if (routeSegments.length !== requestSegments.length) continue;
		const params: Record<string, string> = {};
		let matches = true;
		for (let index = 0; index < routeSegments.length; index += 1) {
			const routeSegment = routeSegments[index];
			const requestSegment = requestSegments[index];
			if (routeSegment.startsWith(':')) {
				params[routeSegment.slice(1)] = decodeURIComponent(requestSegment);
			} else if (routeSegment !== requestSegment) {
				matches = false;
				break;
			}
		}
		if (matches) return { route, params };
	}
	return undefined;
};

export const createApiGateway = (
	getApiSuffix: () => string,
	options: { routes?: ApiRoute[]; loadModule?: (file: string) => Promise<ApiModule> } = {},
) => {
	let matcherPromise: Promise<RouteMatcher> | undefined;
	const getMatcher = () => matcherPromise ??= (async () => createRouteMatcher(options.routes ?? (await loadManifest()).routes))();
	return async (c: Context<AppEnv>, _next: Next) => {
	const route = findRoute(c.req.path, getApiSuffix(), await getMatcher());
	if (!route) return c.json({ message: 'API route not found' }, 404);

	const execute = async (index: number): Promise<Response> => {
		const file = route.route.files[index];
		const module = options.loadModule
			? await options.loadModule(file)
			: await import(new URL(`./${file}`, import.meta.url).href) as ApiModule;
		if (typeof module.default !== 'function') {
			throw new Error(`API route module must export a default handler: ${file}`);
		}
		const next = async () => {
			if (index + 1 >= route.route.files.length) {
				return c.json({ message: 'API route did not return a response' }, 500);
			}
			return execute(index + 1);
		};
		const response = await module.default(c, next, route.params);
		return response ?? c.json({ message: 'API route did not return a response' }, 500);
	};

	return execute(0);
	};
};
