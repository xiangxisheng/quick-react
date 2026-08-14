# 项目架构

## 构建和启动流程

执行 `node esbuild.cjs` 后：

```text
src/index.tsx       -> public/bundle.js
server/app.mts      -> dist/server.mjs
server/templates/   -> 动态首页响应
```

构建完成后，`esbuild.cjs` 会加载 `dist/server.mjs`。Hono 在同一个 8088 端口提供页面、静态资源和 `/api/*` 接口。

## 请求流程

访问 `/` 时，后端生成 `initialData`，由 `server/templates/index.mts` 通过 `window.__INITIAL_DATA__` 注入页面。数据包含页面定义 `pages`、网站导航 `siteNavigation` 和后台菜单 `managementMenu`；页面定义指定路径和组件名称，前端通过组件注册表渲染，后台菜单由服务端生成，后续可在生成函数中按当前用户权限过滤。

静态文件只从 `public/` 提供，`dist/server.mjs` 不在静态目录中。

## 开发监听

`npm run dev` 会监听前端和后端源码。前端构建结果会立即更新；后端源码重新构建后需要重启进程才能加载新模块。
