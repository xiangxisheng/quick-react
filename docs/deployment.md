# 部署指南

服务器要求 Node.js 20 或更高版本。

```bash
npm install
node esbuild.cjs
```

默认端口是 `8088`，也可以通过 `HTTP_PORT` 修改。

如果存在 ACME 证书：

```text
~/.acme.sh/<domain>_ecc/<domain>.key
~/.acme.sh/<domain>_ecc/fullchain.cer
```

后端会尝试启动 HTTPS/HTTP2；证书读取失败时降级为 HTTP。

生产环境应使用进程管理器或容器保证服务自动重启，并在防火墙放行实际使用的端口。
