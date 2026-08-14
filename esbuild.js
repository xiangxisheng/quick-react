const path = require('node:path');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');

const projectDir = __dirname;
const distDir = path.join(projectDir, 'dist');

const createBuildContext = (entryPoint, outfile, options = {}) => esbuild.context({
	entryPoints: [path.join(projectDir, entryPoint)],
	bundle: true,
	sourcemap: true,
	outfile: path.join(distDir, outfile),
	plugins: [{
		name: `rebuild-notify-${outfile}`,
		setup(build) {
			build.onEnd((result) => {
				console.log(`${outfile}: build ended with ${result.errors.length} errors`);
			});
		},
	}],
	...options,
});

const main = async () => {
	const watch = process.argv.includes('--watch');
	const frontend = await createBuildContext('src/index.tsx', 'bundle.js', {
		minify: true,
	});
	const backend = await createBuildContext('server/app.mts', 'server.mjs', {
		platform: 'node',
		format: 'esm',
		target: 'node24',
		packages: 'external',
	});

	const contexts = [frontend, backend];
	if (watch) {
		await Promise.all(contexts.map((context) => context.watch()));
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
