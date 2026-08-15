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

接口文件按请求路径放置在 `server/api/` 目录中，并由网关从根到叶子逐级执行。叶子接口同时支持无后缀和 `.php` 后缀，例如 `/api/panel/admin/data/rows` 与 `/api/panel/admin/data/rows.php` 等价。当前管理后台接口包括：

```text
/api/panel/admin/dashboard
/api/panel/admin/data/columns
/api/panel/admin/data/rows
/api/panel/admin/settings/tech-stack
/api/panel/admin/settings/system-config
```
