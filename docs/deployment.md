# 部署指南

服务器要求 Node.js 22.13 或更高版本，以使用内置的 `node:sqlite`。

```bash
npm install
node esbuild.cjs
```

默认端口是 `8088`，也可以通过 `HTTP_PORT` 修改。

首次启动会创建 `database/default.sqlite`、执行 `global` 与 `base` migration，并初始化 `global` 控制面。打开 `/sign-up.html` 创建首个管理员，然后在控制面配置正式 Host。

Cloudflare Worker 使用 `DEFAULT_DB` D1 Binding，部署前执行 `migrations/d1/` 中的 migration。独立站点 D1 必须作为预声明 Binding 部署；Worker 不动态连接 DSN。

如果存在 ACME 证书：

```text
~/.acme.sh/<domain>_ecc/<domain>.key
~/.acme.sh/<domain>_ecc/fullchain.cer
```

后端会尝试启动 HTTPS/HTTP2；证书读取失败时降级为 HTTP。

生产环境应使用进程管理器或容器保证服务自动重启，并在防火墙放行实际使用的端口。
