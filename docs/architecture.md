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

## 后端驱动页面

普通后台页面由后端提供菜单、页面定义、表格列和数据接口；前端只负责通用布局、表格和表单渲染。新增常规 CRUD 页面时，优先在 `server/navigation.mts` 增加页面/菜单配置，并在 `server/api/` 下增加对应接口文件，无需修改前端。

API 使用物理目录作为分层中间件链。构建阶段扫描 `server/api.mts` 和 `server/api/`，生成 `dist/api-manifest.mjs`；运行时只查 manifest，不再扫描文件系统。请求 `/api/panel/data/rows` 会按顺序执行 `server/api.mts`、`server/api/panel.mts`、`server/api/panel/data.mts` 和 `server/api/panel/data/rows.mts`；任一层直接返回失败响应都会终止后续执行。动态 ID 作为参数传给已匹配的叶子处理文件，例如 `/api/panel/data/rows/row-1` 仍由 `rows.mts` 处理。

## 开发监听

`npm run dev` 会监听前端和后端源码。前端构建结果会立即更新；后端源码重新构建后需要重启进程才能加载新模块。
