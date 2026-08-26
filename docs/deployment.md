# 部署指南

服务器要求 Node.js 22.13 或更高版本，以使用内置的 `node:sqlite`。

```bash
npm install
node esbuild.cjs
```

默认端口是 `8088`，也可以通过 `HTTP_PORT` 修改。

首次启动会创建 `database/default.sqlite`、执行 `global` 与 `base` migration，并初始化 `global` 控制面。打开 `/sign-up.html` 创建首个管理员，然后在控制面配置正式 Host。

Node 站点数据库支持 `sqlite://`、`mysql://` 和 `postgresql://` DSN。MySQL 与 PostgreSQL 使用各自的 `migrations/<dialect>/<group>/` migration；业务查询统一通过参数化 SQL 构造器执行，不依赖 SQLite 占位符或 SQLite 专用语法。

将现有 SQLite 迁移到空的 MySQL 或 PostgreSQL 数据库时，先备份 SQLite 文件，再运行：

```bash
# Passport 独立数据库（默认迁移 base + passport）
npm run migrate:sqlite -- \
  --source database/default.sqlite \
  --target 'postgresql://user:password@127.0.0.1:5432/accounts'

# 显式选择迁移组；global 控制面也迁移时才加入 global
npm run migrate:sqlite -- \
  --source database/default.sqlite \
  --target 'mysql://user:password@127.0.0.1:3306/quick_react' \
  --groups global,base,passport
```

迁移器会先初始化目标方言表结构，只接受空目标业务表，按外键依赖顺序分批复制，保留 64 位 ID，并逐表核对行数。数据复制在一个目标事务中完成，任意表失败都会回滚；PostgreSQL 的 identity 序列会在复制显式 ID 后自动校准。目标 DSN 可能包含密码，执行时应避免将命令写入公开日志。

Cloudflare Worker 使用 `DEFAULT_DB` D1 Binding，部署前执行 `migrations/d1/` 中的 migration。独立站点 D1 必须作为预声明 Binding 部署；Worker 不动态连接 DSN。

如果存在 ACME 证书：

```text
~/.acme.sh/<domain>_ecc/<domain>.key
~/.acme.sh/<domain>_ecc/fullchain.cer
```

后端会尝试启动 HTTPS/HTTP2；证书读取失败时降级为 HTTP。

生产环境应使用进程管理器或容器保证服务自动重启，并在防火墙放行实际使用的端口。

部署前建议执行：

```bash
npm run typecheck
SKIP_SERVER_LISTEN=1 npm test
npm run smoke:multi-site
```
