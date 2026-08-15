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
GET /api/panel/dashboard
```

返回管理后台统计数据、最近记录及最近记录的列配置，数据由后端当前数据源实时计算。Dashboard 前端不再固定列结构。

接口文件按请求路径放置在 `server/api/` 目录中，并由网关从根到叶子逐级执行。叶子接口同时支持无后缀和 `.php` 后缀，例如 `/api/panel/data/rows` 与 `/api/panel/data/rows.php` 等价。当前仍有以下前端引用的待实现接口：

```text
/api/upload
/api/data/*
/api/panel/data/columns
/api/panel/data/rows
```

后续 API 路由应放在 `server/` 中，并通过 Hono 路由注册。
