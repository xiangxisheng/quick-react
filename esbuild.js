function checkAndLoadModule(moduleName) {
	try {
		return require(moduleName);
	} catch (e) {
		if (e.code === 'MODULE_NOT_FOUND') {
			console.log(`Module "${moduleName}" is not installed.`);
			return null;
		} else {
			throw e; // 如果是其他错误，抛出异常
		}
	}
}
(async () => {
	const outfile = "dist/bundle.js";
	const http_port = Number(process.env.HTTP_PORT) || 8088;

	const esbuild = require("esbuild");
	const http = require('https');
	const fs = require('fs/promises');
	const path = require('path');
	const zlib = require('zlib');
	const ZstdCodec = checkAndLoadModule('node-zstd');

	const resFile = async (req, res, fileName, contentType) => {
		const filePath = path.join(__dirname, 'dist', fileName);
		const content = await fs.readFile(filePath, { encoding: 'utf-8' });
		resData(req, res, 200, contentType, content);
	};
	const resData = async (req, res, statusCode, contentType, content, message = '') => {
		console.info(new Date(), `[${statusCode}]`, req.url, message);
		const acceptEncoding = req.headers['accept-encoding'] || '';
		let stream;
		if (0) {
		} else if (ZstdCodec && /\bzstd\b/.test(acceptEncoding)) {
			res.setHeader('Content-Encoding', 'zstd');
			// 注意：需要一个 zstd 库来支持 zstd 压缩，例如 node-zstd。
			const zstd = new ZstdCodec.Simple();
			stream = zstd.compressStream(res);
		} else if (0 && /\bbr\b/.test(acceptEncoding)) {
			res.setHeader('Content-Encoding', 'br');
			stream = zlib.createBrotliCompress();
		} else if (1 && /\bgzip\b/.test(acceptEncoding)) {
			res.setHeader('Content-Encoding', 'gzip');
			stream = zlib.createGzip();
		} else if (1 && /\bdeflate\b/.test(acceptEncoding)) {
			res.setHeader('Content-Encoding', 'deflate');
			stream = zlib.createDeflate();
		}
		res.setHeader('Content-Type', `${contentType}; charset=utf-8`);
		res.writeHead(statusCode);
		if (stream) {
			stream.pipe(res);
			stream.end(content);
		} else {
			// 如果没有支持的压缩格式，则直接发送原始数据。
			res.end(content);
		}
	};
	const options = {
		key: await fs.readFile('/home/coder/.acme.sh/anan.cc_ecc/anan.cc.key'),
		cert: await fs.readFile('/home/coder/.acme.sh/anan.cc_ecc/fullchain.cer')
	};
	const server = http.createServer(options, async (req, res) => {
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
