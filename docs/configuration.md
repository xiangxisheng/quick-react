# 配置说明

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HTTP_PORT` | `8088` | HTTP/HTTPS 监听端口 |
| `DOMAIN` | `anan.cc` | HTTPS 证书目录使用的域名 |
| `PUBLIC_ORIGIN` | 未设置 | SEO canonical URL 的公共 origin，例如 `https://example.com` |
| `TRUSTED_PROXY_IPS` | 常见内网 IPv4 网段 | 可信反向代理地址或网段，逗号分隔 |
| `MAP_ALLOWED_IPS` | 回环地址 | 允许访问 `bundle.js.map` 的客户端地址，逗号分隔 |

示例：

```bash
TRUSTED_PROXY_IPS=10.0.0.10,10.0.0.11 \
MAP_ALLOWED_IPS=127.0.0.1,203.0.113.10 \
node esbuild.cjs
```

如果使用 Cloudflare 和负载均衡，`TRUSTED_PROXY_IPS` 应配置为直接连接 Node 的负载均衡地址，而不是 Cloudflare 地址。
