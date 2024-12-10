(async () => {
	const outfile = "dist/bundle.js";
	const http_port = Number(process.env.HTTP_PORT) || 9001;

	const esbuild = require("esbuild");
	const http = require('http');
	const fs = require('fs/promises');
	const path = require('path');

	const resFile = async (req, res, fileName, contentType) => {
		const filePath = path.join(__dirname, 'dist', fileName);
		const content = await fs.readFile(filePath, { encoding: 'utf-8' });
		resData(req, res, 200, contentType, content);
	};
	const resData = async (req, res, statusCode, contentType, content, message = '') => {
		console.info(new Date(), `[${statusCode}]`, req.url, message);
		res.writeHead(statusCode, { 'Content-Type': `${contentType}; charset=utf-8` });
		res.end(content);
	};
	const server = http.createServer(async (req, res) => {
		try {
			if (req.url === '/') {
				return await resFile(req, res, 'index.html', 'text/html');
			}
			if (req.url === '/bundle.js') {
				return await resFile(req, res, 'bundle.js', 'text/javascript');
			}
			if (req.url === '/bundle.js.map') {
				return await resFile(req, res, 'bundle.js.map', 'application/json');
			}
			if (req.headers.accept.indexOf('text/html') !== -1) {
				return await resFile(req, res, 'index.html', 'text/html');
			}
			return await resData(req, res, 404, 'text/plain', '404 Not Found\n', req.headers.accept);
		} catch (ex) {
			return await resData(req, res, 500, 'text/plain', 'Error reading file\n');
		}
	});
	server.listen(http_port, '0.0.0.0', () => {
		console.log(`Listening on 127.0.0.1:${http_port}`);
	});

	const config = {
		entryPoints: ["./src/index.tsx"],
		bundle: true,
		minify: true,
		sourcemap: true,
		outfile,
		plugins: [
			{
				name: "rebuild-notify",
				setup(build) {
					build.onEnd((result) => {
						console.log(`build ended with ${result.errors.length} errors`);
					});
				},
			},
		],
	};
	const ctx = await esbuild.context(config);
	await ctx.watch();
})();
