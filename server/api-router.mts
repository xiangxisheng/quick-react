import type { Context, Next } from 'hono';
import type { AppEnv } from './types.mjs';

export type ApiNext = () => Promise<Response>;

export type ApiHandler = (
	c: Context<AppEnv>,
	next: ApiNext,
	params: Record<string, string>,
) => Response | Promise<Response | undefined> | undefined;

type ApiModule = {
	default?: ApiHandler;
};

type ApiRoute = {
	path: string;
	files: string[];
};

type ApiManifest = {
	routes: ApiRoute[];
};

const manifestModule = await import(new URL('./api-manifest.mjs', import.meta.url).href) as { default: ApiManifest };
const manifest = manifestModule.default;

const normalizeApiPath = (path: string, apiSuffix: string) => {
	if (!apiSuffix) return path;
	const segments = path.split('/');
	const suffixIndex = segments.findIndex((segment) => segment.endsWith(apiSuffix));
	if (suffixIndex < 0) return path;
	segments[suffixIndex] = segments[suffixIndex].slice(0, -apiSuffix.length);
	return segments.join('/');
};

const findRoute = (path: string, apiSuffix: string) => {
	const normalizedPath = normalizeApiPath(path, apiSuffix);
	const exactRoute = manifest.routes.find((route) => route.path === normalizedPath);
	if (exactRoute) return { route: exactRoute, params: {} };

	const requestSegments = normalizedPath.split('/').filter(Boolean);
	for (const route of manifest.routes) {
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

export const createApiGateway = (getApiSuffix: () => string) => async (c: Context<AppEnv>, _next: Next) => {
	const route = findRoute(c.req.path, getApiSuffix());
	if (!route) return c.json({ message: 'API route not found' }, 404);

	const execute = async (index: number): Promise<Response> => {
		const file = route.route.files[index];
		const module = await import(new URL(`./${file}`, import.meta.url).href) as ApiModule;
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
