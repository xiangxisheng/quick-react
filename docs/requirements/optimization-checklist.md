# 项目优化清单

本文档记录多站点、API 响应协议和前端通用交互的后续优化事项。新增相关功能前，应先检查是否会影响本清单中的协议和测试要求。

## 已完成

- [x] 所有成功和错误响应统一使用 `feedback`。
- [x] 所有响应移除顶层 `message`。
- [x] 增加服务端统一响应助手和严格反馈类型。
- [x] 前端统一使用 `commonApi.apiFetch()` 拦截响应。
- [x] Form 只读取写操作响应中的顶层 `feedback`，不再兼容 GET 的 `form.feedback`。
- [x] 登录、配置表单共用倒计时组件和 `feedback.redirectAfter`。
- [x] 完成基础多租户 Smoke 测试。

## API 响应协议

- [ ] 将业务数据响应结构整理为统一的服务端和前端类型。
- [x] 增加 `apiResponse()`、`apiMessage()`、`apiMessageData()` 等响应助手。
- [x] 确保新增成功、编辑成功、删除成功、登录成功等接口都使用统一响应助手。
- [x] 增加协议测试，验证 2xx/4xx 不返回顶层 `message`，并验证登录 401 返回 `feedback`。
- [x] 错误响应支持 `feedback` 展示配置。
- [x] 4xx/5xx 默认使用 `modal + error`，明确的 `feedback` 可以覆盖默认展示方式。
- [x] 增加非法 `feedback` 类型导致 TypeScript 编译失败的验证。

## 前端反馈与跳转

- [ ] 将成功消息、Modal、倒计时、自动跳转、立即刷新和取消刷新进一步收敛为统一反馈模块。
- [x] 抽取统一的 `redirectAfter` 解析和截止时间计算助手。
- [ ] 让登录页、配置页和 CRUD 页面只传入响应和跳转目标，减少重复状态管理。
- [ ] 增加登录失败、反馈展示和 `redirectAfter` 倒计时测试。

## 多租户与运行时测试

- [ ] 测试 `base -> global -> site1` 继承链和 API 实际归属站点。
- [ ] 测试 Host、通配符 Host 和默认站点解析。
- [ ] 测试父站点循环校验。
- [ ] 测试独立数据库站点之间的数据隔离。
- [ ] 增加 Node SQLite 与 Worker D1 的双运行时测试。
- [ ] 验证 Worker 只使用 `DEFAULT_DB` 或预声明 Binding，不读取任意 DSN。
- [ ] 验证 Node DSN、自定义数据库 migration 和 Worker migration 的行为差异。

## 文档与类型约束

- [ ] 检查所有文档示例不得返回 2xx 顶层 `message`。
- [ ] 检查所有业务 API 不直接调用 `c.json()`。
- [ ] 检查所有成功写接口使用统一响应助手。
- [ ] 将多租户数据库、导航继承、API 路径、反馈协议和请求封装规范互相链接起来。
- [ ] 为新增接口和新增页面增加开发检查清单。
- [ ] 抽取页面路径、API 路径和后缀处理助手，减少字符串拼接。
- [ ] 为路径助手增加类型约束和测试。

## 执行原则

在 API 协议和多租户测试稳定前，暂缓继续增加大型业务模块。每项修改至少运行：

```bash
npm run typecheck
SKIP_SERVER_LISTEN=1 npm test
npm run smoke:multi-tenant
```
