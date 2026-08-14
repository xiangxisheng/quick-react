# 安全说明

## 代理和真实客户端 IP

请求链路可能是：

```text
客户端 -> Cloudflare -> 负载均衡/Nginx -> Node
```

Node 只信任直接连接它的负载均衡地址。只有来自可信代理的请求，Node 才会读取 `CF-Connecting-IP`、`X-Real-IP` 和 `X-Forwarded-For`。

Cloudflare 和负载均衡应负责：

1. 只接受受信任上游的请求。
2. 覆盖客户端提交的转发头。
3. 将真实客户端 IP 写入可信头。

## Source map

`/bundle.js.map` 默认只允许回环地址和 `MAP_ALLOWED_IPS` 中的地址访问。Source map 可能暴露前端源码，生产环境如不需要调试，建议不要公开它。

## 静态文件

浏览器静态目录是 `public/`。后端构建产物位于 `dist/server.mjs`，不会由静态文件中间件提供。
