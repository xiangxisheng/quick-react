const path = require('node:path');
const fs = require('node:fs');
const { validate: validateSiteSchemas } = require('./validate-site-schemas.cjs');

const projectDir = path.resolve(__dirname, '..');
const serverDir = path.join(projectDir, 'server');
const sitesRoot = path.join(serverDir, 'sites');
const modulesRoot = path.join(serverDir, 'modules');
const generatedDir = path.join(serverDir, '.generated');
const outputPath = path.join(generatedDir, 'worker-api-registry.mts');

const collectEntries = (directory) => fs.existsSync(directory)
	? fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) return collectEntries(entryPath);
		return entry.isFile() && entry.name.endsWith('.mts') ? [entryPath] : [];
	})
	: [];

const siteKeys = fs.existsSync(sitesRoot)
	? fs.readdirSync(sitesRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && /^[a-z][a-z0-9_]*$/.test(entry.name))
		.map((entry) => entry.name)
		.sort()
	: [];

const entries = siteKeys.flatMap((site) => {
	const siteRoot = path.join(sitesRoot, site);
	return [path.join(siteRoot, 'api.mts'), ...collectEntries(path.join(siteRoot, 'api'))]
		.filter((entry) => fs.existsSync(entry));
}).sort();
const navigationEntries = siteKeys.map((site) => ({
	site,
	sourcePath: path.join(sitesRoot, site, 'navigation.mts'),
})).filter((entry) => fs.existsSync(entry.sourcePath));
const moduleKeys = fs.existsSync(modulesRoot)
	? fs.readdirSync(modulesRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && /^[a-z][a-z0-9_]*$/.test(entry.name))
		.map((entry) => entry.name)
		.sort()
	: [];
const moduleEntries = moduleKeys.flatMap((moduleKey) => {
	const moduleRoot = path.join(modulesRoot, moduleKey);
	return [path.join(moduleRoot, 'api.mts'), ...collectEntries(path.join(moduleRoot, 'api'))]
		.filter((entry) => fs.existsSync(entry));
});

const moduleName = (sourcePath) => path.relative(serverDir, sourcePath)
	.replace(/\.mts$/, '').split(/[\\/]/).map((part) => part.replace(/[^a-zA-Z0-9]/g, '_')).join('_');
const importPath = (sourcePath) => `../${path.relative(serverDir, sourcePath).replaceAll(path.sep, '/').replace(/\.mts$/, '.mjs')}`;
const outputPathFor = (sourcePath) => path.relative(serverDir, sourcePath).replaceAll(path.sep, '/').replace(/\.mts$/, '.mjs');
const routes = [];

for (const site of siteKeys) {
	const apiRoot = path.join(sitesRoot, site, 'api');
	for (const sourcePath of collectEntries(apiRoot)) {
		const relativePath = path.relative(apiRoot, sourcePath).replaceAll(path.sep, '/');
		const parts = relativePath.split('/');
		const fileName = parts.pop().replace(/\.mts$/, '');
		if (fs.existsSync(path.join(path.dirname(sourcePath), fileName))) continue;
		const routePath = `/api/${[...parts, fileName].join('/')}`;
		const source = fs.readFileSync(sourcePath, 'utf8');
		routes.push({ site, path: routePath });
		if (source.includes('acceptsTrailingParams = true')) routes.push({ site, path: `${routePath}/:id` });
	}
}
for (const moduleKey of moduleKeys) {
	const apiRoot = path.join(modulesRoot, moduleKey, 'api');
	for (const sourcePath of collectEntries(apiRoot)) {
		const relativePath = path.relative(apiRoot, sourcePath).replaceAll(path.sep, '/');
		const parts = relativePath.split('/');
		const fileName = parts.pop().replace(/\.mts$/, '');
		if (fs.existsSync(path.join(path.dirname(sourcePath), fileName))) continue;
		const routePath = `/api/${[...parts, fileName].join('/')}`;
		const source = fs.readFileSync(sourcePath, 'utf8');
		routes.push({ site: moduleKey, path: routePath });
		if (source.includes('acceptsTrailingParams = true')) routes.push({ site: moduleKey, path: `${routePath}/:id` });
	}
}

const imports = [
	...[...entries, ...moduleEntries].map((sourcePath) => `import ${moduleName(sourcePath)} from '${importPath(sourcePath)}';`),
	...navigationEntries.map(({ sourcePath }) => `import ${moduleName(sourcePath)} from '${importPath(sourcePath)}';`),
].join('\n');
const modules = [...entries, ...moduleEntries].map((sourcePath) => `\t'${outputPathFor(sourcePath)}': { default: ${moduleName(sourcePath)} },`).join('\n');
const routeLines = routes.map((route) => `\t${JSON.stringify(route)},`).join('\n');
const navigations = navigationEntries.map(({ site, sourcePath }) => `\t'${site}': ${moduleName(sourcePath)},`).join('\n');

const generate = () => {
	validateSiteSchemas();
	fs.mkdirSync(generatedDir, { recursive: true });
	fs.writeFileSync(outputPath, `${imports}\n\nimport type { ApiModule, SiteApiRoute } from '../api-router.mjs';\nimport type { MenuNode } from '../sites/base/navigation.mjs';\n\nexport const workerApiRoutes: SiteApiRoute[] = [\n${routeLines}\n];\n\nexport const workerApiModules: Record<string, ApiModule> = {\n${modules}\n};\n\nexport const workerApiModuleSites = new Set(${JSON.stringify(moduleKeys)});\n\nexport const workerSiteNavigations: Record<string, MenuNode[]> = {\n${navigations}\n};\n\nexport const workerCodeSites = ${JSON.stringify(siteKeys)} as const;\n`);
};

if (require.main === module) generate();
module.exports = { generate };
