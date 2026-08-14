# quick-react

一个使用 React、Ant Design、esbuild 和 Hono 的轻量级全栈项目。

前端和后端由同一个 `node esbuild.js` 进程构建并启动，默认监听 `8088` 端口。

## 快速开始

需要 Node.js 20 或更高版本：

```bash
npm install
node esbuild.js
```

开发监听模式：

```bash
npm run dev
```

类型检查：

```bash
npm run typecheck
```

浏览器访问：

```text
http://127.0.0.1:8088/
```

## 文档

- [项目架构](docs/architecture.md)
- [开发指南](docs/development.md)
- [部署指南](docs/deployment.md)
- [配置说明](docs/configuration.md)
- [安全说明](docs/security.md)
- [API 说明](docs/api.md)

## 目录结构

```text
src/                    React 前端源码
server/                 Hono 后端源码和动态 HTML 模板
server/templates/       服务端 HTML 模板
public/                 浏览器可访问的静态资源
dist/                   后端构建产物
esbuild.js              前后端构建和启动入口
```

`public/bundle.js`、`public/bundle.js.map` 和 `dist/server.mjs` 都是构建生成文件，不提交到 Git。
