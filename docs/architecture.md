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

访问 `/` 时，后端先使用内存路由快照把 Host 解析为站点，再生成 `initialData`，由 `server/templates/index.mts` 通过 `window.__INITIAL_DATA__` 注入页面。数据只包含 `apiSuffix`、`pageSuffix` 和已经按用户角色过滤的 `siteNavigation`；导航树同时定义菜单、路由路径、页面组件和页面元信息，前端递归导航树生成路由并通过组件注册表渲染。

静态文件只从 `public/` 提供，`dist/server.mjs` 不在静态目录中。

## 后端驱动页面

普通后台页面由后端提供导航、组件标识、表格列和数据接口；前端只负责通用布局、表格和表单渲染。新增常规 CRUD 页面时，在 `server/sites/<site_key>/navigation.mts` 增加导航，并在同一站点的 `api/` 下增加接口文件，无需手工修改路由表。

公共请求和反馈层位于 `src/utils/common/`：`api.tsx` 负责请求加载状态、错误拦截和 `feedback` 展示，`feedback.ts` 负责跳转延迟计算；`src/components/common/Countdown.tsx` 提供登录和配置表单共用的倒计时组件。服务端响应输出统一由 `server/api-response.mts` 负责，业务 API 不直接调用 `c.json()`。

API 使用物理目录作为分层中间件链。构建阶段扫描 `server/sites/*/api`，生成 Worker 可静态打包的站点路由和模块注册表；运行时不扫描文件系统。每一层优先使用当前站点实现，缺少时沿继承链回退到 `base`。动态 ID 作为参数传给已匹配的叶子处理文件，例如 `/api/panel/admin/data/rows/row-1` 仍由 `rows.mts` 处理。

## 开发监听

`npm run dev` 会监听前端和后端源码。前端构建结果会立即更新；后端源码重新构建后需要重启进程才能加载新模块。
