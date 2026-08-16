# 配置说明

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HTTP_PORT` | `8088` | HTTP/HTTPS 监听端口 |
| `DOMAIN` | `anan.cc` | HTTPS 证书目录使用的域名 |
| `PUBLIC_ORIGIN` | 未设置 | SEO canonical URL 的公共 origin，例如 `https://example.com` |
| `TRUSTED_PROXY_IPS` | 常见内网 IPv4 网段 | 可信反向代理地址或网段，逗号分隔 |
| `MAP_ALLOWED_IPS` | 回环地址 | 允许访问 `bundle.js.map` 的客户端地址，逗号分隔 |
| `MASK_NGINX` | `0` | 设为 `1` 后返回 `Server: nginx` |
| `MASK_PHP_VERSION` | 未设置 | 启动时设置 PHP 伪装版本，例如 `8.2.12` |
| `API_ROUTE_SUFFIX` | `.php` | API 请求路径后缀的初始值，可为空 |
| `PAGE_ROUTE_SUFFIX` | `.html` | 页面请求路径后缀的初始值，可为空 |
| `DEFAULT_DATABASE_FILE` | `database/default.sqlite` | Node 默认共享 SQLite 文件；主要用于测试或自定义部署路径 |

示例：

```bash
TRUSTED_PROXY_IPS=10.0.0.10,10.0.0.11 \
MAP_ALLOWED_IPS=127.0.0.1,203.0.113.10 \
node esbuild.cjs
```

如果使用 Cloudflare 和负载均衡，`TRUSTED_PROXY_IPS` 应配置为直接连接 Node 的负载均衡地址，而不是 Cloudflare 地址。

也可以在管理后台的“技术栈伪装”页面动态修改 Nginx 开关、PHP 版本号、API 路径后缀和页面路径后缀。站点配置保存在当前数据库的 `base_system_configs` 表中；后缀支持例如 `.php`、`.json`、`.html`，留空表示无后缀，修改后无需重新构建。

PHP 版本仅接受数字版本格式（例如 `8.2.12`），留空则不发送 PHP 标识。`X-Powered-By: PHP/...` 只会出现在 `/api` 请求中，HTML 和 JS 静态资源不会添加该标识。
