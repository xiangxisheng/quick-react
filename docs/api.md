# API 说明

当前已实现：

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
/api/panel/admin/sites
/api/panel/admin/hosts
```

Node 控制面创建站点后会立即尝试 migration，也可向 `POST /api/panel/admin/sites/<site_key>` 重试；成功后再通过站点更新接口启用。Worker 的 D1 migration 必须由部署流程执行，该操作会返回 `501`。

`/api/panel/*` 需要登录，`/api/panel/admin/*` 还需要 `admin` 角色。空数据库首次初始化后，可通过 `PUT /api/sign` 创建唯一的初始管理员，之后使用 `POST /api/sign` 登录。
