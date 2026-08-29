# 多站点与数据库双模式需求开发文档

状态：已实施

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
    index.mts                    # HTML 文档模板
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
      api.mts                    # 基础层 API 根中间件，只影响 /api/*
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

## 4.0 页面渲染与 API 中间件

页面 HTML 继续由现有的公共模板和文档渲染逻辑处理：

```text
server/templates/index.mts  # HTML 拼接和 __INITIAL_DATA__ 输出
Worker 文档渲染逻辑         # 根据请求路径生成页面元数据并调用模板
```

这里不新增 `index.mts` 页面路由，也不新增站点级 `templates/` 目录；页面路径仍由现有的 Worker 文档路由统一处理。站点目录只用于 API、导航和业务覆盖。

`base/api.mts` 是基础层 API 根中间件，只作用于 `/api/*`。API 子路径是否存在处理器由实际 API 文件决定，不要求额外创建 `api/index.mts`，缺少某个路径处理器也不影响其他子路径。


## 4.1 global 控制面与 base 基础层

`global` 是可访问的控制面站点，`base` 是不可直接访问的基础代码层：

可路由的代码级站点只有 `global` 和各业务站点，例如 `site1`、`site2`；`base` 只作为公共基础层参与继承，不注册为站点，不绑定 Host，也不单独生成站点路由。

```text
base     提供登录、用户、会话、配置和默认后台功能，不作为独立站点路由
global   继承 base，并额外管理 global_sites、global_site_hosts 和站点生命周期
```

`base` 不是可绑定 Host 的站点，不直接出现在 `global_site_hosts` 中。`global` 使用 `base` 提供的登录、用户和会话接口，再覆盖站点和 Host 管理接口。其 API 和导航继承关系为：

```text
global 覆盖实现
  -> base 基础层实现
```

`global` 是系统控制面，不能作为业务站点的父站点；业务站点的继承链只能包含其他业务站点并最终回到 `base`。

例如 `global` 没有登录接口时，自动使用 `base` 的登录接口；`global` 只需要额外提供站点和 Host 管理接口即可。`site1` 也可以直接以 `base` 作为基础，不需要继承 `global`。

`global` 和普通业务站点默认都使用 `default.sqlite`。其中 `global_*` 保存站点注册信息，`base_*` 保存共享数据库中跨站点共用的用户、会话和通行证数据，`site1_*` 等前缀保存对应站点的业务数据。代码继承和表前缀选择是两个独立维度；只有 Node 运行时显式配置了自定义 DSN 的站点才使用外部独立数据库。

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

每个业务表固定归属其声明代码级站点，继承不会把该表重映射为子站点前缀。例如，登录能力和 `base_system_users` 由 `base` 声明；`site1` 继承登录 API 时，仍通过 `base` 的 Repository 与 `base_*` 表执行。`site2` 继承 `site1` 的 API 时，`site1` 声明的表仍为 `site1_*`。因此，共享数据库中的继承站点会共享其父站点声明表中的业务数据；需要独立业务数据时，应在子站点声明自己的 `site2_*` 表和覆盖 API，而不是依赖自动改写表前缀。

构建阶段必须检查父站点存在、继承链无循环且不超过最大深度。数据库中新建或修改站点时也必须执行同样的校验。

所有站点走同一套解析逻辑，代码里不存在按站点标识的分支，能力只来自代码站点目录和继承链：

1. Accounts 登录（OIDC 客户端）及其“Accounts 登录”系统设置页由 `base` 提供，因此每个站点都有，身份中心站点自己也有。登录策略保存在当前数据库的同一个 `accounts-oidc-client` 配置项中：Passport、Global 和业务站点共用数据库时，任一站点修改开关都对三者同时生效；分离数据库后才由各数据库分别配置。
2. Accounts 身份与 OIDC 端点由 `passport` 代码站点提供，继承了 `passport` 的站点才有，因为身份数据表由 `passport` 声明。

即：站点之间的差异只体现为“继承了哪个代码站点”和“自己的系统设置怎么配”，与 `global`、`passport` 这些具体标识无关。

每个站点都只有 `/sign` 一个对外登录入口、一个 `/api/sign` 接口和一个退出入口，链接对所有站点完全相同；页面内容由本站的 `/api/sign` 决定。身份提供方额外拥有内部 `/accounts/sign` 和 `/api/accounts/sign`，不作为普通站点登录入口，只服务于 OIDC 认证和 Accounts 账号管理。

1. 共享开关关闭：Passport、Global 和业务站点都使用本地账号密码登录（Base 实现）。
2. 共享开关开启：Passport、Global 和业务站点的 `/sign` 都走同一个 Accounts OIDC 客户端流程。Passport 另保留 `/accounts/sign` 作为身份提供方的原生认证页，OIDC 授权端点只在没有 Accounts 会话时转入该页，避免 `/sign` 自身 OIDC 循环。
3. 开关切换后不接受上一种模式留下的会话：开启时只接受 Accounts 会话，关闭时只接受本地密码会话。

差异只来自站点目录里的覆盖文件，不来自运行时判断。头部入口同样只看当前持有哪些会话：有本站会话给个人中心，有 Accounts 会话给账户中心，退出统一走 `/sign`。是否显示注册入口看本站数据库里初始管理员是否还没创建。

需要“找到身份中心站点”的地方（Issuer 候选域名、Telegram 机器人回调域名、控制面读取身份数据）一律用“谁实现了 `/api/accounts/sign`”来定位，不写死站点标识。身份中心自己的接口也不再额外校验站点标识：这些文件只存在于 `passport` 代码站点，网关本来就只会把继承它的站点路由过去。

请求解析需要区分代码级站点和业务站点：

```text
Host
  -> global_site_hosts
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

对应的请求路径仍然是（`apiSuffix` 默认配置为 `.php` 时）：

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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  base_site_key TEXT,
  dsn TEXT NOT NULL DEFAULT '',
  dsn_password TEXT,
  database_binding TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'enabled',
  migration_status TEXT NOT NULL DEFAULT 'ready',
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  CHECK (site_key GLOB '[a-z]*' AND site_key NOT GLOB '*[^a-z0-9_]*')
);

CREATE UNIQUE INDEX global_sites_one_default
  ON global_sites(is_default) WHERE is_default = 1 AND status = 'enabled';

CREATE TABLE global_site_hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hostname TEXT NOT NULL UNIQUE,
  site_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enabled',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (site_key) REFERENCES global_sites(site_key)
);
```

`global` 是系统控制面引导站点，不依赖管理员先创建数据。`global` migration 必须幂等写入以下记录：

```text
site_key: global
name: 全局控制面
base_site_key: base
dsn: ''
status: enabled
migration_status: ready
is_default: 1
is_system: 1
```

SQLite/D1 migration 使用等价于以下语义的幂等插入；其他数据库方言由迁移生成器产生等价 SQL：

```sql
INSERT INTO global_sites (
  site_key, name, base_site_key, dsn, status, migration_status, is_default, is_system
) VALUES ('global', '全局控制面', 'base', '', 'enabled', 'ready', 1, 1)
ON CONFLICT(site_key) DO NOTHING;
```

系统记录不可删除、不可禁用、不可修改 `site_key`，并且必须始终是唯一的启用默认站点。生产初始化任务必须在站点上线前为它写入至少一个明确的 `global_site_hosts` 控制面 Host；默认站点回退仍按本节匹配规则处理未绑定 Host，用于首次配置和明确允许的默认入口。

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

只有 `status = 'enabled'` 且 `migration_status = 'ready'` 的 Host 和站点可参与解析。默认站点为唯一的启用 `global_sites.is_default = 1` 记录；没有默认站点时不回退。

Host 标准化规则：

- 转为小写。
- 移除端口。
- 移除末尾的点。
- 正确处理 IPv6。
- 国际化域名统一转换为可比较格式。

如果部署在反向代理后面，只在代理属于可信列表时使用转发的 Host 信息，不能无条件信任 `X-Forwarded-Host`。

## 6. 站点名、站点标识和数据库

站点显示名称和站点标识必须分开；默认数据库固定为 `default.sqlite`，不由站点名称或 `site_key` 推导。`site_key` 主要用于路由、表前缀和站点 schema。它是受控的程序标识，创建后不可修改；只允许小写 ASCII 字母、数字和下划线，必须以字母开头。Repository 只可使用构建期路由注册表和已校验的 `site_key` 生成 SQL 标识符，绝不能把请求参数或未经校验的后台输入拼接为表名：

| 字段 | 用途 | 是否允许修改 |
| --- | --- | --- |
| `site_key` | 稳定的程序标识、路由和表前缀标识 | 原则上不修改 |
| `global_sites.name` | 后台显示的站点名称 | 可以修改 |
| `global_sites.base_site_key` | 当前站点未覆盖时使用的基础层或父站点 | 原则上不修改 |
| `global_sites.is_system` | 系统引导站点标记；系统站点不可删除、禁用或改标识 | 不允许修改 |
| `dsn` | 不含密码的数据库连接地址；为空时使用默认 SQLite | 可以修改 |
| `dsn_password` | 单独保存的数据库密码；接口不返回真实值 | 可以修改 |
| `database_binding` | Worker 预声明的站点 D1 Binding 名称；为空时使用 `DEFAULT_DB` | 可以修改 |

例如，独立数据库首次为 `site2` 建库时：

```text
site_key:  site2
site name: 业务站点 2
database:  postgres://db.example.com:5432/site2
```

不能使用站点显示名称作为数据库标识，因为显示名称可能被管理员修改。默认所有站点使用 `default.sqlite`；只有配置自定义 DSN 时才使用外部数据库。

Node 模式默认只有一个共享数据库，站点通过表前缀隔离：

```text
database/default.sqlite
base_system_users
base_system_sessions
site1_orders
```

如果未来支持 MySQL 或 PostgreSQL，`dsn` 保存不含密码的连接地址，`dsn_password` 单独保存密码。`dsn` 为空时自动使用 `sqlite://database/default.sqlite`。后台接口不返回真实密码，日志中的 DSN 也必须脱敏。任意 DSN 只允许 Node 运行时连接；Worker 不读取或使用它。

`dsn` 为空时使用默认的 `sqlite://database/default.sqlite`；自定义 DSN 只影响当前站点的数据库连接。自定义数据库中仍需应用该站点继承链对应的 `base_*` 和站点专属 migration。独立数据库中的 `base_system_users`、会话和角色只在该库内有效，不与默认共享数据库或其他独立数据库共享。

`dsn` 与 `database_binding` 互斥。修改任一数据库目标时，站点必须自动切换为 `disabled + creating`，重新完成目标数据库 migration 后才能启用。

## 7. Host 内存缓存

服务启动或首次请求时，把可路由的站点配置和 `hosts` 整表加载到内存并建立不可变路由快照：

```text
exactHosts: Map<hostname, siteKey>
wildcardHosts: 按后缀长度降序排列
sites: Map<siteKey, { status, migrationStatus, baseSiteKey, databaseTarget }>
defaultSiteKey?: siteKey
```

普通请求只读取该路由快照，不访问数据库；快照同时提供 Host、站点状态、继承链和数据库目标，避免 Host 命中后再次查询 `global_sites`。

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
global_sites / global_site_hosts
base_system_users / base_system_sessions / base_system_configs
site1_orders / site1_configs
site2_orders / site2_configs
```

Cloudflare Worker 只使用 `DEFAULT_DB` 或部署时预先声明的站点 D1 Binding；它不支持、也不得尝试通过 `dsn` 动态连接任意数据库。Node 使用一个 `default.sqlite`，并可按站点连接已配置的自定义 DSN。两种运行时都通过 Repository 选择已校验的表前缀，而不是每次请求创建或查询站点数据库。

如果确实需要物理隔离，Node 部署可让站点配置自定义 DSN；Worker 部署只能选用预声明的站点 D1 Binding。这属于可选的独立数据库模式，不是默认的多站点模型。

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
global_site_hosts
```

`base.prisma` 定义所有继承站点共用的通行证基础表，模型名直接使用数据库表名，并且只在目标数据库中生成一份：

```text
base_system_users
base_system_sessions
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
  id       Int    @id @default(autoincrement())
  site_key String @unique
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

用户身份和额外角色均保存在 `base_system_users` 中，例如 `roles` JSON 字段保存 `['admin']`。角色不按站点区分：在同一数据库内，用户的额外角色对所有继承站点生效。角色名称由后端代码约定，导航生成时根据当前用户的角色过滤菜单。

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

用户记录只保存额外角色，例如：

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

如果站点配置了自定义 DSN，则把 `base`、父站点和当前站点的继承链 migration 应用到该站点对应的数据库中。`global_sites` 和 `global_site_hosts` 仍保留在默认数据库中，用于 Host 解析和数据库路由。

新增站点或切换到新的数据库时，必须先执行完整 migration，再允许站点接收请求。创建流程必须使用状态机：先创建 `migration_status = creating` 的站点，迁移任务将其更新为 `migrating`，成功后原子更新为 `ready` 并可启用 Host；失败则更新为 `failed`，请求一律不路由到该站点。

全局数据库包含 `global` migration；该 migration 除创建表结构外，还必须幂等初始化 `global` 系统控制面站点，使空数据库可立即通过默认站点进入系统：

```text
database/default.sqlite
  └── global migrations
```

Node 可以在启动时对默认共享数据库执行未应用的 migration；Cloudflare D1 使用 Wrangler 的 `d1_migrations` 记录已应用 migration，在部署阶段执行，不在每个请求中执行。Worker 不能因后台动态创建站点而自行执行 D1 migration：动态建站必须由受控的 Node 迁移任务或 CI/CD 部署流程完成。自定义 DSN 站点需要由 Node 迁移任务对其目标数据库单独执行对应 migration。

Prisma 生成的 SQL 需要检查 D1 兼容性，必要时手动调整后再部署。

## 11. 实施顺序

本节保留架构实施顺序；已经完成的条目以实际代码和 Smoke 测试为准，后续维护应同步更新状态，不要将本节误解为当前全部待办事项。工程优化待办统一记录在 `docs/requirements/optimization-checklist.md`。

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

当前主要实现入口：

- 站点与 Host 解析：`server/site-router.mts`
- Node 数据库初始化与 migration：`server/app.mts`
- Worker 数据库选择与 Binding 限制：`server/worker.mts`
- API 继承和路由注册：`server/api-router.mts`
- 站点目录 API 覆盖：`server/sites/<site_key>/api/`

## 12. 验收重点

- 默认模型为单 D1/单 SQLite 加表前缀；独立 D1 只允许作为预声明 Binding 的固定站点部署方式。
- 空 DSN 必须连接 Node 的 `default.sqlite` 或 Worker 的 `DEFAULT_DB`；非空 DSN 只能由 Node 运行时连接。
- 新增站点必须通过受控迁移任务创建表结构并完成 migration；只有 `migration_status = 'ready'` 的站点可参与路由。
- `global` migration 必须幂等创建唯一的 `global` 系统控制面记录，并将其设为启用默认站点；该记录不可删除、禁用或修改 `site_key`。
- 生产初始化任务必须为 `global` 写入至少一个明确的控制面 Host；默认回退仅作为首次配置和明确允许的默认入口。
- 通配符 Host 只能匹配一层子域名。
- 未匹配 Host 时，存在启用默认站点则回退；否则返回 404。
- Host 路由快照最大刷新间隔为 30 秒，普通请求不查询数据库。
- 只实现角色级访问控制，不增加权限表、站点成员关系或细粒度权限管理；`base_system_users` 中的额外角色在同一数据库内对所有继承站点生效，受保护 API 必须独立进行角色校验。
- `database/` 是纯运行时目录，必须完全忽略 Git。
- Prisma schema 只用于模型定义、校验和 migration，不进入 Worker runtime。
- 不支持不同站点长期运行不同 schema 版本。同一发布版本下，所有可路由的共享库和独立库必须满足该版本要求的 migration 基线；独立库迁移完成前保持不可路由。

多个 Prisma schema 可以共同描述同一个数据库，但 migration 必须由统一的构建或迁移流程编排：先校验所有 schema 的模型名和表名前缀，再按 `global -> base -> 父站点 -> 当前站点` 顺序生成或执行 SQL，不能让各个 schema 独立维护互相不知情的 migration 历史。

## 站点数据库配置与迁移（2026-08-27 补充）

### 部署形态

global 站点跟随业务站点部署，不单独占一台服务器：每个部署都自带一份 global 数据（`global_*` 表在该部署的默认库里），passport 等站点即使使用独立数据库，读到的仍然是同一个部署的 global 数据。因此"站点迁出独立数据库"只搬 `base` 和站点自身的表，`global_*` 始终留在默认库。跨部署的 global 数据一致性后续由"global 数据下发"功能解决，不在本次范围内。

### 结构化数据库配置

站点管理页不再填写裸 DSN，改为按字段配置，保存时由后端拼成 DSN 写入 `global_sites.dsn`，运行时解析逻辑不变：

| 字段 | 适用类型 | 说明 |
| --- | --- | --- |
| 数据库类型 | 全部 | 跟随默认库 / SQLite 文件 / MySQL / PostgreSQL / Cloudflare D1 Binding |
| SQLite 文件 | sqlite | 相对路径基于项目目录 |
| 主机、端口、数据库名、用户名、密码 | mysql、postgresql | 端口留空按 3306 / 5432 处理；密码留空表示保留原密码 |
| D1 Binding | binding | 大写字母、数字和下划线 |

- 列表和详情**不返回 DSN**，只返回不含密码的只读描述（例如 `MySQL db.internal:3306/shop`），避免数据库密码泄露到前端。
- 字段按数据库类型条件显示（`dependsOn` + `parentValues`），切换类型会自动清掉不适用的字段。

### 三个操作按钮

| 按钮 | 请求 | 行为 |
| --- | --- | --- |
| 测试连接 | `POST .../sites/<key>?action=test` | 连接目标库并报告表数量；跟随默认库时提示无需测试，D1 Binding 由部署环境注入无法测试 |
| 执行结构迁移 | `POST .../sites/<key>?action=migrate` | 在目标库按继承链执行 migration |
| 迁移数据 | `POST .../sites/<key>?action=transfer` | 把默认库中该站点的数据（`base` + 继承链上有独立表的站点分组）复制到站点数据库 |

数据迁移复用 `transferPortableDatabase`：目标库相关表必须为空、逐表校验行数、整体在事务中执行，源库必须是 SQLite，目标库必须是 MySQL 或 PostgreSQL。SQLite 之间的搬迁请直接复制文件。

覆盖测试：`npm run test:site-database`。
