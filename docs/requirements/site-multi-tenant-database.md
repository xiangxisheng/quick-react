# 多站点与数据库双模式需求开发文档

状态：待审核，尚未实施

## 1. 背景

当前项目的 API、导航和配置主要位于统一的 `server/api` 与 `server/navigation.mts` 下。后续需要支持多个站点，每个站点可以拥有独立的 API、导航、配置和表前缀；需要时也可以通过 DSN 使用独立数据库。

旧项目 `/opt/firadio/cfwk-firadio` 已经验证过 Node 与 Cloudflare D1 双模式：Worker 使用 D1，Node 使用 SQLite，并通过统一的 D1 风格接口访问数据库。

## 2. 目标

- 站点业务代码按站点目录隔离。
- Node 本地运行时使用 SQLite 文件。
- Cloudflare Worker 运行时使用 D1。
- 保留 Prisma schema 作为数据库模型定义。
- Worker 运行时不引入 Prisma Client 或其他重量级 ORM。
- 通过数据库中的 `hosts` 表，将请求 Host 映射到具体站点。
- `hosts` 数据整表加载到内存，普通请求不查询数据库。
- 保留现有目录中间件链和后端驱动页面架构。

## 3. 目录规划

```text
server/
  api-router.mts                 # 通用 API 路由匹配器
  site-router.mts                # Host 到站点的解析
  worker.mts
  templates/
  database/
    index.mts                    # 数据库抽象
    d1.mts                       # Cloudflare D1 适配器
    sqlite.mts                   # Node SQLite 适配器
  sites/
    global/
      api.mts                    # global 控制面站点
      navigation.mts
      api/
        health.mts
        panel/
          admin/
            sites.mts
            hosts.mts
    base/
      api.mts                    # 基础层根中间件
      navigation.mts             # 基础层导航
      api/
        health.mts
        panel.mts
        panel/
          admin.mts
          admin/
            dashboard.mts
            settings.mts
            settings/
              system-config.mts
              tech-stack.mts
            data.mts
            data/
              columns.mts
              rows.mts

prisma/
  global.prisma                  # default.sqlite 的站点和 Host 模型
  base.prisma                    # base 基础层模型
  site1.prisma                   # site1 自己的业务模型
  site2.prisma                   # site2 自己的业务模型

migrations/
  global/                        # global_* 表
  base/                          # base_* 表
  site1/                         # site1_* 表

database/
  default.sqlite                 # Node 默认共享数据库
  backups/                       # 数据库备份
```

`database/` 只保存运行时数据库和备份，应加入 `.gitignore`；`prisma/`、`migrations/` 和 `server/database/` 属于源码，需要提交 Git。

## 4. 站点 API 路径

## 4.1 global 控制面与 base 基础层

`global` 是可访问的控制面站点，`base` 是不可直接访问的基础代码层：

可路由的代码级站点只有 `global` 和各业务站点，例如 `site1`、`site2`；`base` 只作为公共基础层参与继承，不注册为站点，不绑定 Host，也不单独生成站点路由。

```text
base     提供登录、用户、会话、配置和默认后台功能，不作为独立站点路由
global   继承 base，并额外管理 global_sites、global_hosts 和站点生命周期
```

`base` 不是可绑定 Host 的站点，不直接出现在 `global_hosts` 中。`global` 使用 `base` 提供的登录、用户和会话接口，再覆盖站点和 Host 管理接口。其 API 和导航继承关系为：

```text
global 覆盖实现
  -> base 基础层实现
```

例如 `global` 没有登录接口时，自动使用 `base` 的登录接口；`global` 只需要额外提供站点和 Host 管理接口即可。`site1` 也可以直接以 `base` 作为基础，不需要继承 `global`。

`global` 和普通业务站点默认都使用 `default.sqlite`。其中 `global_*` 保存站点注册信息，`base_*` 保存跨站点共用的用户、会话和通行证数据，`site1_*` 等前缀保存对应站点的业务数据。代码继承和表前缀选择是两个独立维度；只有显式配置了自定义 DSN 的站点才使用外部独立数据库。

创建业务站点时，不复制 `base` 的 API 文件，只需要：

1. 在 `global_sites` 注册新的 `site_key`。
2. 在共享数据库中执行该站点前缀对应的 migration。
3. 应用该站点的默认导航和配置。

因此新站点创建后会自动拥有 `base` 的健康检查、用户、会话、系统配置和默认管理接口。

### 站点 API 覆盖

业务站点可以只提供需要修改的 API 文件，其余接口自动回退到 `base`：

```text
server/sites/base/api/panel/admin/data.mts          # 基础实现
server/sites/site1/api/panel/admin/data.mts         # site1 覆盖实现
```

访问 `site1` 时：

```text
/api/panel/admin/data       -> site1/api/panel/admin/data.mts
/api/panel/admin/settings   -> base 对应实现
```

目录中间件链也逐层回退。假设 `site1` 只有 `data.mts`：

```text
site1/api/panel/admin/data.mts
base/api.mts
base/api/panel.mts
base/api/panel/admin.mts
```

如果某一层存在 site1 版本，则只替换该层；不存在时继续使用 base 版本。site1 也可以增加 base 没有的新 API。

覆盖规则：

1. 先查当前业务站点的同路径实现。
2. 找不到时查 `base` 实现。
3. 两者都不存在时返回 404。
4. 当前业务站点的中间件优先于 base 同层中间件。

构建阶段需要为每个站点生成覆盖路由索引，运行时不扫描文件系统；路由注册表只保存模块路径和站点覆盖关系。

站点可以形成多级继承链，例如：

```text
site2 -> site1 -> base
```

构建阶段必须检查父站点存在、继承链无循环且不超过最大深度。数据库中新建或修改站点时也必须执行同样的校验。

请求解析需要区分代码级站点和业务站点：

```text
Host
  -> global_hosts
  -> site_key
  -> base_site_key 继承链（global/site1 -> base 基础层）
  -> 选择代码级 API
  -> 选择共享数据库及对应表前缀
```

默认情况下所有站点使用 `default.sqlite`。多个域名可以绑定到同一个业务站点，因此会共享同一套 base 代码和同一组站点表。站点配置自定义 DSN 后，才切换到该站点自己的数据库连接。

站点目录不暴露到 URL。文件路径：

```text
server/sites/base/api/panel/admin/settings/system-config.mts
```

对应的请求路径仍然是：

```text
/api/panel/admin/settings/system-config.php
```

构建阶段 API 注册器需要扫描 `server/sites/*/api`，生成包含代码级站点标识的路由：

```ts
{
  site: 'global',
  path: '/api/panel/admin/settings/system-config',
  files: [...]
}
```

同一代码级站点内仍然按照物理目录执行中间件链。`health` 属于 `global` 或具体业务站点；未覆盖时回退到 `base` 基础层。因此旧的 `server/api` 目录整体废弃，不再保留全局业务 API。

## 5. Host 绑定

站点与请求 Host 的关系由数据库维护，不写死在代码中。

```sql
CREATE TABLE global_sites (
  site_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_site_key TEXT,
  dsn TEXT NOT NULL DEFAULT '',
  dsn_password TEXT,
  status TEXT NOT NULL DEFAULT 'enabled'
);

CREATE TABLE global_hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hostname TEXT NOT NULL UNIQUE,
  site_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enabled',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (site_key) REFERENCES global_sites(site_key)
);
```

`hostname` 支持精确 Host 和通配符 Host：

```text
example.com
www.example.com
*.example.com
```

因为通配符是字符串的一部分，`hostname UNIQUE` 仍然可以同时保存 `example.com` 和 `*.example.com`。

匹配优先级：

1. 精确 Host。
2. 最长通配符后缀。
3. 配置的默认站点。
4. 没有匹配且没有默认站点时返回 404。

`*.example.com` 默认只匹配一层子域名，不匹配 `example.com` 和 `a.b.example.com`。

Host 标准化规则：

- 转为小写。
- 移除端口。
- 移除末尾的点。
- 正确处理 IPv6。
- 国际化域名统一转换为可比较格式。

如果部署在反向代理后面，只在代理属于可信列表时使用转发的 Host 信息，不能无条件信任 `X-Forwarded-Host`。

## 6. 站点名、站点标识和数据库

站点显示名称和站点标识必须分开；默认数据库固定为 `default.sqlite`，不由站点名称或 `site_key` 推导。`site_key` 主要用于路由、表前缀和站点 schema：

| 字段 | 用途 | 是否允许修改 |
| --- | --- | --- |
| `site_key` | 稳定的程序标识、路由和表前缀标识 | 原则上不修改 |
| `global_sites.name` | 后台显示的站点名称 | 可以修改 |
| `global_sites.base_site_key` | 当前站点未覆盖时使用的基础层或父站点 | 原则上不修改 |
| `dsn` | 不含密码的数据库连接地址；为空时使用默认 SQLite | 可以修改 |
| `dsn_password` | 单独保存的数据库密码；接口不返回真实值 | 可以修改 |

例如，独立数据库首次为 `site2` 建库时：

```text
site_key:  site1
site name: 业务站点 1
database:  database/default.sqlite
```

不能使用站点显示名称作为数据库标识，因为显示名称可能被管理员修改。默认所有站点使用 `default.sqlite`；只有配置自定义 DSN 时才使用外部数据库。

Node 模式默认只有一个共享数据库，站点通过表前缀隔离：

```text
database/default.sqlite
base_system_users
base_system_sessions
site1_orders
```

如果未来支持 MySQL 或 PostgreSQL，`dsn` 保存不含密码的连接地址，`dsn_password` 单独保存密码。`dsn` 为空时自动使用 `sqlite://database/default.sqlite`。后台接口不返回真实密码，日志中的 DSN 也必须脱敏。

`dsn` 为空时使用默认的 `sqlite://database/default.sqlite`；自定义 DSN 只影响当前站点的数据库连接。自定义数据库中仍需应用该站点继承链对应的 `base_*` 和站点专属 migration。

## 7. Host 内存缓存

服务启动或首次请求时，把 `hosts` 整表加载到内存并建立索引：

```text
exactHosts: Map<hostname, siteKey>
wildcardHosts: 按后缀长度降序排列
```

普通请求只进行内存匹配，不访问数据库。

数据库访问时机：

- 服务首次启动。
- 缓存超过约 30 秒。
- 后台保存 Host 配置后主动刷新当前实例。

Node 多实例和 Cloudflare Worker 实例之间不能保证即时刷新，因此采用 30 秒最大刷新间隔。实例休眠或扩容后会重新加载缓存。

## 8. 数据库双模式

业务层只依赖统一接口：

```text
Repository
  -> D1 adapter       # Worker
  -> SQLite adapter   # Node
```

Node 模式：

```text
database/default.sqlite
```

默认部署模型是单数据库加表前缀：

```text
global_sites / global_hosts
base_system_users / base_system_sessions / base_system_configs
site1_orders / site1_configs
site2_orders / site2_configs
```

Cloudflare 使用一个 `DEFAULT_DB` D1 Binding；Node 使用一个 `default.sqlite`。两种运行时都通过 Repository 选择表前缀，而不是每次请求创建或查询站点数据库。

如果确实需要物理隔离，可以让站点配置自定义 DSN；这属于可选的独立数据库模式，不是默认的多站点模型。

Cloudflare 也可以使用每站点一个 D1，但每个站点需要预先声明独立 Binding，适合站点数量固定的场景，不作为动态建站的默认方案。


## 9. Prisma schema 与 ORM 边界

保留 Prisma schema 作为数据库模型和关系定义，但不在 Worker 运行时使用 Prisma Client：

```text
prisma/
  global.prisma        # default.sqlite 的全局表
  base.prisma          # base 代码站点的通用业务表
  site1.prisma         # site1 业务表
```

`global.prisma` 中只定义跨站点注册信息，模型名直接使用数据库表名，统一使用 `global_` 前缀：

```text
global_sites
global_hosts
```

`base.prisma` 定义所有继承站点共用的通行证基础表，模型名直接使用数据库表名，并且只在目标数据库中生成一份：

```text
base_system_users
base_system_sessions
base_system_site_memberships
base_system_configs
```

因此 `global`、`site1` 和 `site2` 都使用 `base_system_users` 完成登录和通行证身份识别，不生成 `site1_users`、`site2_users` 或 `global_users`。如果某个站点需要扩展用户资料，应新增 `site1_user_profiles` 之类的站点表，通过 `user_id` 关联 `base_system_users`。

### Prisma schema 命名校验

Prisma 模型名允许使用小写字母和下划线，因此不使用 `@@map`，直接让模型名成为物理表名。每个 schema 文件都有自己的命名空间，构建阶段必须检查模型名称：

```text
global.prisma  -> 所有 Model 以 global_ 开头，表名就是模型名
base.prisma    -> 所有 Model 以 base_ 开头，表名就是模型名
site1.prisma   -> 所有 Model 以 site1_ 开头，表名就是模型名
```

例如 `site1.prisma` 只能定义 `model site1_orders`、`model site1_products` 等模型，模型名就是实际表名。站点 schema 只定义当前站点新增的业务表，不重复定义继承来的 `base_system_users`、`base_system_sessions` 等模型。

在默认共享数据库中，`global.prisma`、`base.prisma` 和所有启用站点的 schema 可以共同生成到 `default.sqlite`；在独立 DSN 数据库中，则按该站点的继承链生成 `base.prisma`、父站点 schema 和当前站点 schema。无论采用哪种模式，`base_*` 表都只在目标数据库中生成一份。

示例：

```prisma
model global_sites {
  id Int @id @default(autoincrement())
}

model base_system_users {
  id Int @id @default(autoincrement())
}
```

构建校验内容包括：

- Model 名称是否符合当前 schema 的前缀。
- 是否存在不符合小写下划线命名规范的模型。
- 不同 schema 生成的物理表名是否冲突。
- 站点继承链生成的表名是否重复或越界。

校验失败时构建直接失败，避免把 `User`、`Config` 等无前缀模型或错误表名部署到 D1/SQLite。

```text
Prisma schema       模型定义
SQL migrations      部署变更
Repository          运行时查询
```

Prisma 仅作为开发期工具使用，生成或检查 migration；运行时使用原生 SQL、预处理语句和 D1/SQLite 适配器。

这样可以保留模型定义，同时避免 Prisma Client 增大 Worker bundle 或引入 Node 专属依赖。

## 角色与权限范围

当前不建立权限表，也不实现细粒度权限系统。角色直接在后端导航配置中定义，例如：

```ts
{
  label: '系统配置',
  key: 'system-config',
  roles: ['admin']
}
```

用户身份保存在 `base_system_users` 中；如果角色需要按站点区分，则保存在 `base_system_site_memberships` 中。角色名称由后端代码约定，导航生成时根据当前用户在当前站点的角色过滤菜单。

角色分为三类：

```text
public  所有人，包含未登录用户
user    登录用户默认拥有
admin   只能由后台分配
```

有效角色按登录状态计算：

```text
未登录用户：public
普通用户：public + user
管理员：public + user + admin
```

用户或站点成员关系只保存额外角色，例如：

```json
["admin"]
```

不需要把 `public` 和 `user` 重复写入用户记录。管理员默认继承普通用户能力。

菜单示例：

```ts
{ label: '登录', key: '/sign', roles: ['public'] }
{ label: '修改密码', key: 'change-password', roles: ['user'] }
{ label: '系统配置', key: 'system-config', roles: ['admin'] }
```

菜单隐藏不等于接口授权。对于需要保护的站点 API，仍需要在站点根中间件或 API 中间件中做最基本的角色校验；这里只是不引入独立的权限资源、权限表和权限管理页面。

## 10. 多站点 Migration

Migration 与 ORM 无关，使用提交到 Git 的 SQL 文件：

```text
migrations/
  global/
  base/
  site1/
```

Migration 是数据库结构级别的变更，不是站点业务数据。业务数据不继承，但表结构按基础站点继承链应用。

例如：

```text
site2 -> site1 -> base

default.sqlite
  = global migration
  + base migration（只生成一份 base_*）
  + site1 migration（生成 site1_*）
  + site2 migration（生成 site2_*）
```

站点继承只继承表结构和代码能力，不复制业务数据。`site2 -> site1 -> base` 时，独立数据库按完整继承链执行 migration；共享 `default.sqlite` 已经存在父站点表时，只执行缺失的 migration，不能重复创建 `base_*` 或 `site1_*`。当前站点始终只生成自己的 `site2_*` 表，`base_system_users` 等通行证表始终只有一份。

因此迁移规划器需要根据目标数据库已有的 migration 记录和表前缀，区分以下两种情况：

```text
共享 default.sqlite：补齐 global/base/父站点/当前站点的缺失结构
独立 DSN 数据库：按继承链完整初始化 base/父站点/当前站点结构，global 表仍在 default.sqlite
```

默认共享数据库为：

```text
database/default.sqlite
```

如果站点配置了自定义 DSN，则把 `base`、父站点和当前站点的继承链 migration 应用到该站点对应的数据库中。`global_sites` 和 `global_hosts` 仍保留在默认数据库中，用于 Host 解析和数据库路由。

新增站点或切换到新的数据库时，必须先执行完整 migration，再允许站点接收请求。

全局数据库包含 `global` migration：

```text
database/default.sqlite
  └── global migrations
```

Node 可以在启动时对默认共享数据库执行未应用的 migration；Cloudflare D1 使用 Wrangler 的 `d1_migrations` 记录已应用 migration，在部署阶段执行，不在每个请求中执行。自定义 DSN 站点需要对其目标数据库单独执行对应 migration。

Prisma 生成的 SQL 需要检查 D1 兼容性，必要时手动调整后再部署。

## 11. 实施顺序

1. 增加 `prisma/global.prisma`、`prisma/base.prisma` 和各业务站点的 `<site_key>.prisma`，分别定义全局、base 和站点业务表。
2. 增加 SQL migration 和 migration 版本管理。
3. 抽象 D1/SQLite 统一数据库接口。
4. 增加 Node SQLite 连接缓存，并将数据库文件移动到 `database/`。
5. 增加站点解析器和 `hosts` 内存缓存。
6. 将 `server/api` 整体迁移到 `server/sites/base/api`，并增加 `global` 控制面站点。
7. 修改 API 注册器，生成带 `site` 字段的路由表。
8. 增加 Prisma schema 命名和表名校验。
9. 将导航和站点配置迁移到 `server/sites/base/`，实现站点覆盖和多级继承。
10. 增加 Host 管理接口和后台页面。
11. 验证 Node、Worker、D1 migration、通配符 Host 和默认站点行为。

## 12. 审核重点

- 是否采用单 D1/单 SQLite + 表前缀作为默认模型，独立 D1 仅作为固定站点的可选部署方式。
- 空 DSN 是否始终连接 `default.sqlite`/`DEFAULT_DB`，非空 DSN 再切换到外部数据库。
- 新增站点时是否自动创建表前缀并执行完整 migration。
- 多数据库模式下是否允许不同站点使用不同 schema 版本。
- 通配符是否只匹配一层子域名。
- 未匹配 Host 是否允许回退默认站点。
- Host 缓存刷新间隔是否固定为 30 秒。
- 是否只保留角色级访问控制，不增加权限表和细粒度权限管理。
- `database/` 是否作为纯运行时目录并完全忽略 Git。
- Prisma schema 是否只用于模型定义和 migration，不进入 Worker runtime。

多个 Prisma schema 可以共同描述同一个数据库，但 migration 必须由统一的构建或迁移流程编排：先校验所有 schema 的模型名和表名前缀，再按 `global -> base -> 父站点 -> 当前站点` 顺序生成或执行 SQL，不能让各个 schema 独立维护互相不知情的 migration 历史。
