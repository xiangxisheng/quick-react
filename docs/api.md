# API 说明

当前已实现：

## 响应协议

后端接口统一使用 `server/api-response.mts`：

```ts
apiResponse(c, status, data)
apiMessage(c, status, message?, feedback?, data?)
apiMessageData(c, status, message, data, feedback?)
```

其中 `apiMessage()` 可以省略 `message`，按状态码使用默认消息；`apiMessageData()` 的 `message` 为必填参数，因为它固定采用“消息、数据、反馈配置”的参数顺序。

成功响应（2xx）需要提示时使用 `feedback`，不返回顶层 `message`：

```json
{
  "feedback": {
    "component": "message",
    "type": "success",
    "message": "新增成功"
  },
  "site_key": "site1"
}
```

列表和详情等纯数据响应不需要 `feedback`：

```json
{
  "table": {
    "columns": [],
    "dataSource": [],
    "totalRecords": 0
  }
}
```

错误响应（4xx/5xx）同样使用 `feedback.message`：

```json
{
  "feedback": {
    "component": "message",
    "type": "error",
    "message": "用户名或密码错误"
  }
}
```

如果需要控制错误展示方式，只需调整 `feedback`，不需要重复返回顶层 `message`：

```json
{
  "feedback": {
    "component": "modal",
    "type": "error",
    "message": "用户名或密码错误"
  }
}
```

如果错误响应没有 `feedback`，前端默认以 `modal + error` 展示；旧接口仅有顶层 `message` 时也会被转换为该默认反馈。

## 健康检查

```text
GET /api/health
```

返回：

```json
{"ok":true}
```

## 管理后台 Dashboard

```text
GET /api/panel/admin/dashboard
```

返回管理后台统计数据、最近记录及最近记录的列配置，数据由后端当前数据源实时计算。Dashboard 前端不再固定列结构。

接口文件按请求路径放置在 `server/sites/<site_key>/api/` 目录中，并由网关按站点继承链从根到叶子逐级执行。叶子接口同时支持无后缀和配置的 API 后缀，例如 `/api/panel/admin/data/rows` 与 `/api/panel/admin/data/rows.php` 等价。当前接口包括：

```text
/api/panel/admin/dashboard
/api/panel/admin/data/columns
/api/panel/admin/data/rows
/api/panel/admin/settings/tech-stack
/api/panel/admin/settings/system-config
/api/page-status
/api/sign
```

Accounts 账号中心（仅 `passport` 站点，需要 Accounts 会话）：

```text
/api/accounts/center/overview
/api/accounts/center/profile
/api/accounts/center/emails
/api/accounts/center/security
```

`/api/accounts/sign` 是分步表单：第一步提交邮箱，已注册邮箱返回可用登录方式（密码、Telegram 消息批准、已启用的第三方），未注册邮箱返回确认步骤并在确认后进入第三方认证。登录成功后如果还没有用户名或密码，会继续返回补全步骤的 `formPage`，全部完成才返回 `redirectTo`。密码步骤支持 `POST /api/accounts/sign?action=skip_password` 跳过，跳过只对本次登录生效。

`GET /api/page-status?path=<页面路径>` 返回该路径的访问状态，供前端路由兜底页面展示提示；路径不存在返回 `404`、未登录返回 `401`、角色不足返回 `403`，路径可访问但前端没有对应渲染组件时返回 `500`。接口本身始终以 `200` 返回 `pageStatus`，不触发全局错误弹窗。

`global` 控制面额外提供：

```text
/api/panel/admin/global/site/sites
/api/panel/admin/global/site/hosts
/api/panel/admin/global/cloud/credentials
/api/panel/admin/global/cloud/object-storage/buckets
/api/panel/admin/global/cloud/object-storage/bindings
/api/panel/admin/global/cloud/object-storage/objects
```

云能力采用凭据优先模型。凭据保存 Provider、访问密钥以及必要的账号上下文，例如 Cloudflare Account ID；Endpoint 不保存在凭据中。对象存储 API 直接创建 Bucket 接入配置，不创建通用服务身份。Bucket 页面不提交人工名称、服务类型或 Provider；Provider 由凭据推导。站点绑定把已配置的 Bucket 按用途绑定到站点；对象管理通过绑定解析 Bucket 配置和凭据，并返回预签名上传、下载地址。

目标 Bucket 表单使用 `GET /api/panel/admin/global/cloud/object-storage/buckets?action=discover&field=bucket&cloud_credential_id=<id>` 读取 Bucket。选择项可以携带安全的字段回填值，用于自动设置 Endpoint、Region 和 Path Style，但不得包含 Secret 或签名。自动 Endpoint 可以在 Bucket 配置中覆盖；`other`/MinIO 无法只根据凭据发现资源，直接手工填写 Bucket 和 Endpoint。

所有凭据行统一提供测试 action，并通过 `POST /api/panel/admin/global/cloud/credentials/<id>?action=test` 执行。Provider 注册了独立测试处理器时执行真实校验；未注册时返回“该自定义凭据暂不支持独立测试，请在 Bucket 配置中测试”的反馈。前端不硬编码 Provider。每个 Bucket 通过 `POST /api/panel/admin/global/cloud/object-storage/buckets/<id>?action=test` 验证凭据、Endpoint、Region 和 Bucket 的组合配置。

对象列表采用通用游标分页协议：请求使用 `cursor` 和 `pageSize`，表格响应使用 `nextCursor` 和 `hasMore`。TableCRUD 只保存已经访问过的页游标，因此可以前后翻页，不要求后端计算对象总数，也不把对象存储的 continuation token 暴露为前端专用协议。

常用写操作的响应状态码为：创建资源使用 `201`，修改、删除和登录成功使用 `200`；参数校验失败通常使用 `400`，未登录使用 `401`，无权限使用 `403`，资源不存在使用 `404`。

Node 控制面创建站点后会立即尝试 migration，也可向 `POST /api/panel/admin/global/site/sites/<site_key>` 重试；成功后再通过站点更新接口启用。Worker 的 D1 migration 必须由部署流程执行，该操作会返回 `501`。

`/api/panel/*` 需要登录，`/api/panel/admin/*` 还需要 `admin` 角色。空数据库首次初始化后，可通过 `PUT /api/sign` 创建唯一的初始管理员，之后使用 `POST /api/sign` 登录。
