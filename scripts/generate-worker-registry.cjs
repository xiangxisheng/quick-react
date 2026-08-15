const path = require('node:path');
const fs = require('node:fs');

const projectDir = path.resolve(__dirname, '..');
const serverDir = path.join(projectDir, 'server');
const apiRoot = path.join(serverDir, 'api');
const generatedDir = path.join(serverDir, '.generated');
const outputPath = path.join(generatedDir, 'worker-api-registry.mts');

const collectEntries = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
	const entryPath = path.join(directory, entry.name);
	if (entry.isDirectory()) return collectEntries(entryPath);
	return entry.isFile() && entry.name.endsWith('.mts') ? [entryPath] : [];
});

const entries = [path.join(serverDir, 'api.mts'), ...collectEntries(apiRoot)].sort();
const moduleName = (relativePath) => relativePath.replace(/\.mts$/, '').split(/[\\/]/).map((part) => part.replace(/[^a-zA-Z0-9]/g, '_')).join('_');
const importPath = (sourcePath) => `../${path.relative(serverDir, sourcePath).replaceAll(path.sep, '/').replace(/\.mts$/, '.mjs')}`;
const outputPathFor = (sourcePath) => path.relative(serverDir, sourcePath).replaceAll(path.sep, '/').replace(/\.mts$/, '.mjs');
const routeEntries = [];

for (const sourcePath of entries.filter((entry) => entry !== path.join(serverDir, 'api.mts'))) {
	const relativePath = path.relative(apiRoot, sourcePath).replaceAll(path.sep, '/');
	const parts = relativePath.split('/');
	const fileName = parts.pop().replace(/\.mts$/, '');
	if (fs.existsSync(path.join(path.dirname(sourcePath), fileName))) continue;
	const routeSegments = [...parts, fileName];
	const files = ['api.mjs'];
	for (let index = 0; index < routeSegments.length; index += 1) {
		files.push(`api/${routeSegments.slice(0, index + 1).join('/')}.mjs`);
	}
	const routePath = `/api/${routeSegments.join('/')}`;
	routeEntries.push({ path: routePath, files });
	if (fs.readFileSync(sourcePath, 'utf8').includes('acceptsTrailingParams = true')) {
		routeEntries.push({ path: `${routePath}/:id`, files });
	}
}

const imports = entries.map((sourcePath) => `import ${moduleName(path.relative(serverDir, sourcePath))} from '${importPath(sourcePath)}';`).join('\n');
const modules = entries.map((sourcePath) => {
	const output = outputPathFor(sourcePath);
	return `\t'${output}': { default: ${moduleName(path.relative(serverDir, sourcePath))} },`;
}).join('\n');
const routes = routeEntries.map((route) => `\t${JSON.stringify(route)},`).join('\n');

const generate = () => {
	fs.mkdirSync(generatedDir, { recursive: true });
	fs.writeFileSync(outputPath, `${imports}\n\nimport type { ApiModule, ApiRoute } from '../api-router.mjs';\n\nexport const workerApiRoutes: ApiRoute[] = [\n${routes}\n];\n\nexport const workerApiModules: Record<string, ApiModule> = {\n${modules}\n};\n`);
};

if (require.main === module) generate();
module.exports = { generate };
