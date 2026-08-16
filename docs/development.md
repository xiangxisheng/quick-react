# 开发指南

安装依赖：

```bash
npm install
```

启动构建和服务：

```bash
node esbuild.cjs
```

启动监听模式：

```bash
npm run dev
```

执行类型检查：

```bash
npm run typecheck
```

前端代码位于 `src/`，后端代码位于 `server/`。站点 API 和导航位于 `server/sites/<site_key>/`；`base` 是继承基础层，`global` 是控制面站点。新增后端模板或静态资源时，注意不要把服务端文件放入 `public/`。

## API 请求与响应反馈规范

前端业务代码必须通过 `useCommonApi()` 提供的 `commonApi.apiFetch()` 发起 API 请求。禁止在业务组件中直接使用原生 `fetch`，否则请求不会经过统一的加载状态、错误处理和响应反馈拦截器。登录、注册、表格 CRUD、配置表单等页面同样适用此规范。

`apiFetch` 会先解析 JSON 响应，再按 HTTP 状态码处理：

- `2xx` 响应进入成功反馈处理；普通 `message` 会显示为全局成功提示。
- 非 `2xx` 响应进入统一错误处理，并抛出响应对象；接口返回的 `message` 会显示在错误提示中，调用方只负责捕获异常并停止后续业务流程。
- 调用方不应重复弹出响应中的 `message`，也不应使用 `window.alert` 替代统一反馈。

需要控制反馈样式时，在写操作的响应 JSON 中返回 `saveFeedback`。该字段只属于写操作响应，不放在 GET 返回的表单配置中：

```json
{
  "message": "保存成功",
  "saveFeedback": {
    "component": "inline",
    "type": "success",
    "showIcon": true,
    "title": "保存结果",
    "message": "保存成功"
  }
}
```

`saveFeedback.component` 支持 `inline`、`message`、`modal` 和 `none`。`modal` 可额外返回 `refreshNowLabel` 与 `cancelRefreshLabel`；`none` 表示不显示反馈。响应同时包含 `saveFeedback` 时，拦截器优先使用它，不会再次显示普通 `message`。

新增或修改接口时，必须保持上述响应协议；新增前端请求入口时，必须接入 `commonApi.apiFetch`。完成修改后至少运行 `npm run typecheck` 和 `SKIP_SERVER_LISTEN=1 npm test`。
