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
/api/sign
```

`global` 控制面额外提供：

```text
/api/panel/admin/global/sites
/api/panel/admin/global/hosts
```

常用写操作的响应状态码为：创建资源使用 `201`，修改、删除和登录成功使用 `200`；参数校验失败通常使用 `400`，未登录使用 `401`，无权限使用 `403`，资源不存在使用 `404`。

Node 控制面创建站点后会立即尝试 migration，也可向 `POST /api/panel/admin/global/sites/<site_key>` 重试；成功后再通过站点更新接口启用。Worker 的 D1 migration 必须由部署流程执行，该操作会返回 `501`。

`/api/panel/*` 需要登录，`/api/panel/admin/*` 还需要 `admin` 角色。空数据库首次初始化后，可通过 `PUT /api/sign` 创建唯一的初始管理员，之后使用 `POST /api/sign` 登录。
