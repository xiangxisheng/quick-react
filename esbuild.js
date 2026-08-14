const path = require('node:path');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');

const projectDir = __dirname;
const distDir = path.join(projectDir, 'dist');
const publicDir = path.join(projectDir, 'public');

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
	const frontend = await createBuildContext('src/index.tsx', publicDir, 'bundle.js', {
		minify: true,
	});
	const backend = await createBuildContext('server/app.mts', distDir, 'server.mjs', {
		platform: 'node',
		format: 'esm',
		target: 'node18',
		packages: 'external',
	});

	const builds = [frontend, backend];
	const contexts = builds.map(({ context }) => context);
	if (watch) {
		await Promise.all(contexts.map((context) => context.watch()));
		await Promise.all(builds.map(({ initialBuild }) => initialBuild));
		console.log('Watching frontend and backend sources');
	} else {
		try {
			await Promise.all(contexts.map((context) => context.rebuild()));
		} finally {
			await Promise.all(contexts.map((context) => context.dispose()));
		}
	}

	await import(`${pathToFileURL(path.join(distDir, 'server.mjs')).href}?startup=${Date.now()}`);
};

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
