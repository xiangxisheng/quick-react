const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
const { generate: generateWorkerRegistryFile } = require('./scripts/generate-worker-registry.cjs');

const projectDir = __dirname;
const distDir = path.join(projectDir, 'dist');
const publicDir = path.join(projectDir, 'public');

const collectApiEntries = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
	const entryPath = path.join(directory, entry.name);
	if (entry.isDirectory()) return collectApiEntries(entryPath);
	return entry.isFile() && entry.name.endsWith('.mts') ? [entryPath] : [];
});

const createApiBuilds = () => [
	path.join(projectDir, 'server', 'api.mts'),
	...collectApiEntries(path.join(projectDir, 'server', 'api')),
].map((sourcePath) => {
	const relativeSource = path.relative(projectDir, sourcePath);
	const relativeOutput = path.relative(
		distDir,
		path.join(distDir, relativeSource.replace(/^server[\\/]api(?=([\\/]|\.mts$))/, 'api').replace(/\.mts$/, '.mjs')),
	);
	return createBuildContext(relativeSource, distDir, relativeOutput, {
		platform: 'node',
		format: 'esm',
		target: 'node18',
		packages: 'external',
	});
});

const createApiManifest = () => {
	const apiRoot = path.join(projectDir, 'server', 'api');
	const entries = collectApiEntries(apiRoot);
	const routes = [];
	entries.forEach((sourcePath) => {
		const relativePath = path.relative(apiRoot, sourcePath).replaceAll(path.sep, '/');
		const parts = relativePath.split('/');
		const fileName = parts.pop().replace(/\.mts$/, '');
		// 有同名子目录的文件是中间层 middleware，不是可直接请求的叶子接口。
		if (fs.existsSync(path.join(path.dirname(sourcePath), fileName))) return;
		const routeSegments = [...parts, fileName];
		const routePath = `/api/${routeSegments.join('/')}`;
		const files = ['api.mjs'];
		for (let index = 0; index < routeSegments.length; index += 1) {
			files.push(`api/${routeSegments.slice(0, index + 1).join('/')}.mjs`);
		}
		const source = fs.readFileSync(sourcePath, 'utf8');
		routes.push({ path: routePath, files });
		if (source.includes('acceptsTrailingParams = true')) {
			routes.push({ path: `${routePath}/:id`, files });
		}
	});
	const manifest = { routes };
	fs.mkdirSync(distDir, { recursive: true });
	fs.writeFileSync(
		path.join(distDir, 'api-manifest.mjs'),
		`export default ${JSON.stringify(manifest)};\n`,
	);
};

const createRuntimeConfig = () => {
	fs.mkdirSync(distDir, { recursive: true });
	fs.writeFileSync(
		path.join(distDir, 'runtime-config.mjs'),
		`export default ${JSON.stringify({})};\n`,
	);
};

const createBuildContext = async (entryPoint, outputDir, outfile, options = {}) => {
	let initialBuildResolve;
	let initialBuildReject;
	let initialBuildCompleted = false;
	const initialBuild = new Promise((resolve, reject) => {
		initialBuildResolve = resolve;
		initialBuildReject = reject;
	});
	const context = await esbuild.context({
		entryPoints: [path.join(projectDir, entryPoint)],
		bundle: true,
		sourcemap: true,
		outfile: path.join(outputDir, outfile),
		plugins: [{
			name: `rebuild-notify-${outfile}`,
			setup(build) {
				build.onEnd((result) => {
					console.log(`${outfile}: build ended with ${result.errors.length} errors`);
					if (!initialBuildCompleted) {
						initialBuildCompleted = true;
						if (result.errors.length > 0) {
							initialBuildReject(new Error(`${outfile} initial build failed`));
						} else {
							initialBuildResolve();
						}
					}
				});
			},
		}],
		...options,
	});
	return { context, initialBuild };
};

const main = async () => {
	const watch = process.argv.includes('--watch');
	generateWorkerRegistryFile();
	const frontend = await createBuildContext('src/index.tsx', publicDir, 'bundle.js', {
		minify: true,
	});
	const backend = await createBuildContext('server/app.mts', distDir, 'server.mjs', {
		platform: 'node',
		format: 'esm',
		target: 'node18',
		packages: 'external',
	});
	const worker = await createBuildContext('server/worker.mts', distDir, 'worker.mjs', {
		platform: 'neutral',
		format: 'esm',
		target: 'es2022',
	});
	const apiBuilds = await Promise.all(createApiBuilds());
	const builds = [frontend, backend, worker, ...apiBuilds];
	const contexts = builds.map(({ context }) => context);
	if (watch) {
		await Promise.all(contexts.map((context) => context.watch()));
		await Promise.all(builds.map(({ initialBuild }) => initialBuild));
		createRuntimeConfig();
		createApiManifest();
		console.log('Watching frontend and backend sources');
	} else {
		try {
			await Promise.all(contexts.map((context) => context.rebuild()));
		} finally {
			await Promise.all(contexts.map((context) => context.dispose()));
		}
		createApiManifest();
		createRuntimeConfig();
	}

	await import(`${pathToFileURL(path.join(distDir, 'server.mjs')).href}?startup=${Date.now()}`);
};

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
