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

## 架构特征

本项目不是普通的前后端分离后台模板，而是面向站长搭建多套业务系统的多站点内核，主要特点如下。

### API 目录级熔断

API 目录本身就是分层中间件链，每一级目录都可以在进入子接口前终止请求：

```text
/api
  -> sites/<site>/api.mts
  -> api/panel.mts
  -> api/panel/admin.mts
  -> api/panel/admin/data.mts
  -> api/panel/admin/data/rows.mts
```

目录处理器可以直接返回响应，熔断后续执行；也可以调用 `next()` 继续进入下一级：

```ts
if (!c.get('effectiveRoles').includes('admin')) {
  return apiMessage(c, 403, '需要管理员权限');
}
return next();
```

因此登录校验、角色校验、模块状态检查和参数前置检查可以放在目录级完成，不需要复制到每个叶子接口。该机制还和站点覆盖、父站点回退结合：当前站点可以替换任意一级目录中间件，缺少时沿继承链继续使用基础实现。

### 多运行时数据库适配

同一套业务 API 同时支持 Node.js + SQLite 和 Cloudflare Worker + D1。数据库访问通过统一适配器完成；Worker 只访问默认 Binding 或预声明的站点 Binding，Node 运行时才支持 SQLite DSN。

### 站点继承与表归属分离

业务站点可以继承 `base` 或其他业务站点，只覆盖需要修改的 API、导航和页面配置。代码继承不会改变业务表归属：表由声明它的代码级站点固定拥有，子站点继承父级 API 时仍访问父级声明的表。

### 后端驱动页面

导航、页面组件、表格列、表单字段、校验规则和文案由后端返回，前端通过 `shared/types` 中的协议类型渲染通用组件。这样新增常规管理页面主要是增加后端导航和 API 配置，而不是重复编写前端页面。

### 前后端共享协议

`shared/types/` 集中保存跨运行时协议，包括 API 反馈、FormPage、表格、Dashboard、导航、初始化数据和用户身份。Node、Worker 和浏览器端共同使用这些类型，减少接口漂移和重复 DTO。

### 统一反馈与动作调度

所有接口消息都放在 `feedback` 中。反馈可以描述普通消息、Inline、Modal、倒计时和后续动作；前端通过 `runAfterFeedback` 统一处理登录跳转、退出刷新和表单刷新，业务页面不再重复实现倒计时和延迟逻辑。

### 路径与运行时伪装

页面路径和 API 路径由同一套路由配置生成，并支持 `.html`、`.php` 等可配置后缀。技术栈配置还可以伪装 Server、Nginx、PHP 版本等响应特征，便于兼容性测试和隐藏实际服务实现。

## 开发监听

`npm run dev` 会监听前端和后端源码。前端构建结果会立即更新；后端源码重新构建后需要重启进程才能加载新模块。
