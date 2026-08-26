# Passport 与 Telegram 集成需求

状态：方案已确认，待实现

本文档定义统一身份中心、Telegram 机器人管理、Telegram webhook、业务站点身份引用以及旧项目数据迁移方案。

## 1. 总体架构

系统使用 `passport` 作为统一身份中心。业务站点不再维护自己的用户账号、密码或登录态，只保存 Passport 用户 ID 和本站点业务数据。

```text
global
  global_*                 平台控制面、站点、Host、Telegram 机器人

passport
  passport_*              用户、Session、邮箱、手机、Telegram、头像、OAuth/OIDC
  /api/tgwebhook           Telegram Update 入口及业务处理

业务站点
  <site>_*                 站点业务数据
  passport_user_id         引用 Passport 用户
```

`base` 仍是通用代码基础层，不是身份数据归属层。登录、用户管理和个人中心等通用能力后续应覆盖为 Passport 实现，避免业务站点独立数据库中出现用户表。

global 管理员和 Passport 用户完全分离：global 管理员使用平台后台账号；Passport 用户不能直接通过用户名和密码注册。

## 2. 数据库边界

运行时必须同时区分当前业务数据库和全局数据库：

```text
globalDatabase
  -> default.sqlite 或默认 D1
  -> 读取 global_*，包括机器人配置

passportDatabase
  -> Passport 独立 SQLite 或 D1
  -> 读取和写入 passport_* 身份数据

siteDatabase
  -> 当前业务站点独立 SQLite、D1 或共享数据库中的站点表
  -> 只保存本站业务数据及 passport_user_id
```

每个站点继续遵循现有数据库路由规则：未配置独立 DSN 时直接使用 `default.sqlite` 或默认 D1；配置独立 DSN 或 Binding 后才使用独立数据库。因此 Passport 不新增固定的 `PASSPORT_DB` 变量。

当 Passport 后期迁移到独立数据库时，Passport webhook 仍可通过运行时预声明的 `DEFAULT_DB` 访问 global 数据库获取机器人配置。Node 使用 `default.sqlite`，Worker 使用默认 D1 Binding；不得通过文件系统扫描或运行时动态发现数据库。

请求上下文应显式提供 `globalDatabase` 和当前 `database`，业务代码不得依赖变量名称猜测数据库用途。

跨站点登录统一使用 Passport Session。Session 存储在 Passport 数据库，业务站点通过统一身份上下文解析当前 `passport_user_id`，再查询本站点的成员和角色关系；业务站点不得建立自己的身份 Session。跨站登录使用 Passport 的登录跳转和一次性登录票据，由目标站点建立自己的安全 Cookie，避免依赖单个全局 Cookie 域。更换域名后旧域名 Cookie 可以失效，用户在新域名重新登录即可恢复，不能因为某个域名失效导致整个身份系统不可用。

## 3. Passport 用户模型

### 3.1 用户身份

- 用户的稳定主键必须继续使用老项目生成的雪花数值 ID。
- 迁移旧数据时必须原样保留旧 `userid`，不得重新生成或改为 SQLite 自增 ID。
- 新用户也必须使用与老项目完全兼容的雪花 ID 生成逻辑，绝不能使用 SQLite `AUTOINCREMENT` 或其他自增 ID。
- 生成算法必须保持老项目的参数和位布局：自定义 Epoch `1288834974657`，时间戳占 41 位，Worker ID 占 10 位，序列号占 12 位；Worker ID 继续来自配置，序列号从 0 开始递增并按 `0xFFF` 截断。
- 新实现必须处理同一毫秒内的并发和序列号冲突，保证新生成 ID 在 Passport 范围内唯一；多实例部署时必须为实例分配不重复的 Worker ID。
- 数据库字段可以使用 `TEXT` 保存雪花 ID，避免 JavaScript `number` 精度丢失；API 和前端统一以字符串传输。
- 业务站点只能保存 `passport_user_id`，不得复制用户名、密码或完整身份资料作为本地用户记录。

### 3.2 身份建立和 Passport 负责的能力

Passport 用户必须先通过受信任的外部身份建立初始身份，再绑定邮箱。首期实现：

- Telegram 身份；

微信扫码和 Google 身份作为后续外部身份接入，首期预留数据结构但不实现登录流程。

用户名和密码只能在身份建立后作为附加登录方式设置，不能作为首次注册入口。手机登录和手机绑定暂不实现。

这里统一称为“外部身份”或“外部账号”，不称为“OAuth 用户”：OAuth 是 Google、微信等登录授权所使用的协议，Telegram 机器人账号不属于 OAuth 用户。新建 `user_id` 必须同时具备外部身份和邮箱；没有外部身份不能进入创建用户的第一步，也不能发送用于创建用户的邮箱验证码。已经匹配到已有 Passport 用户的外部身份或邮箱只能进入用户选择或绑定流程，不自动合并账号。

Passport 统一负责：

- 注册、登录、退出登录和 Session；
- 用户名、密码和登录安全策略；
- Telegram 账号绑定；
- 邮箱添加、验证和解绑；
- 手机添加、验证和解绑（暂不实现）；
- 头像上传、替换和删除（后续阶段）；
- 个人资料和账号设置；
- 全局身份角色；
- 后续 OAuth/OIDC 授权能力。

允许配置多个外部身份绑定到同一个 Passport 用户。一个用户绑定多个 Telegram 机器人时仍然只对应一个 `user_id`，不得因为机器人不同而创建新用户。

头像二进制文件后续存储在现有对象存储绑定中，文件路径由 `user_id` 推导；头像上传和头像迁移不属于本期实施范围。

### 3.3 业务站点用户关系

业务站点如需保存成员、订阅、偏好或站点角色，应建立自己的关系表，例如：

```text
site_members
  id
  passport_user_id
  site_role
  status
  created_at
  updated_at
```

站点表中的 `passport_user_id` 必须引用 Passport 用户 ID。站点可以拥有自己的业务角色，但不能因此创建第二套登录账号。

### 3.4 规范化表结构

以下结构用于替代旧 CouchDB 的索引文档。所有数据库中的身份 ID、Telegram ID、Chat ID 和时间字段使用 64 位整数类型：SQLite 使用 `INTEGER`，MySQL 和 PostgreSQL 使用 `BIGINT`。Node 内部使用 `bigint` 或字符串，API JSON 始终使用字符串，禁止转换为 JavaScript `number`。

Passport 新增表的字段统一使用 `NOT NULL`；不使用 `NULL` 或空字符串表达未设置。可选能力使用独立关联表，字符串字段必须在写入前得到有效值，枚举字段必须使用明确的状态值。

```text
passport_users
  user_id BIGINT PRIMARY KEY            -- 兼容老项目雪花 ID
  nickname TEXT NOT NULL
  status TEXT NOT NULL DEFAULT 'enabled'
  created_at BIGINT NOT NULL
  updated_at BIGINT NOT NULL

passport_user_credentials                -- 用户主动设置密码后才创建
  id BIGINT PRIMARY KEY
  user_id BIGINT NOT NULL
  password TEXT NOT NULL                 -- 与 base_system_users.password 相同的 JSON 格式
  created_at BIGINT NOT NULL

passport_sessions
  id TEXT PRIMARY KEY
  user_id BIGINT NOT NULL
  expires_at BIGINT NOT NULL
  created_at BIGINT NOT NULL

passport_telegram_accounts
  id BIGINT PRIMARY KEY
  user_id BIGINT NOT NULL
  bot_id BIGINT NOT NULL
  telegram_user_id BIGINT NOT NULL
  chat_id BIGINT NOT NULL
  nickname TEXT NOT NULL
  created_at BIGINT NOT NULL
  updated_at BIGINT NOT NULL

passport_oauth_accounts
  id BIGINT PRIMARY KEY
  user_id BIGINT NOT NULL
  provider TEXT NOT NULL                 -- wechat / google
  provider_user_id TEXT NOT NULL         -- Provider 侧稳定用户 ID
  created_at BIGINT NOT NULL
  updated_at BIGINT NOT NULL

passport_emails
  id BIGINT PRIMARY KEY
  email TEXT NOT NULL
  verified INTEGER NOT NULL DEFAULT 0
  created_at BIGINT NOT NULL
  updated_at BIGINT NOT NULL

passport_user_emails
  user_id BIGINT NOT NULL
  email_id BIGINT NOT NULL
  is_primary INTEGER NOT NULL DEFAULT 0
  created_at BIGINT NOT NULL
  PRIMARY KEY (user_id, email_id)

passport_email_otp
  id BIGINT PRIMARY KEY
  user_id BIGINT NOT NULL
  email_id BIGINT NOT NULL
  code_hash TEXT NOT NULL
  attempt_count INTEGER NOT NULL DEFAULT 0
  status TEXT NOT NULL DEFAULT 'pending'    -- pending / used / expired
  expires_at BIGINT NOT NULL
  created_at BIGINT NOT NULL

passport_user_roles
  user_id BIGINT NOT NULL
  role TEXT NOT NULL
  created_at BIGINT NOT NULL
  PRIMARY KEY (user_id, role)

passport_group_prompts
  id BIGINT PRIMARY KEY
  chat_id BIGINT NOT NULL
  actor_id BIGINT NOT NULL
  state_json TEXT NOT NULL DEFAULT '{}'
  expires_at BIGINT NOT NULL
  created_at BIGINT NOT NULL
  updated_at BIGINT NOT NULL
```

`passport_users.user_id` 必须由兼容老项目的雪花 ID 生成器产生，不能使用自增 ID。其它表的 `id` 可以使用数据库自增实现，但跨数据库 migration 必须保持 64 位整数语义。头像对象路径后续由 `user_id` 推导为 `avatars/<user_id>.<ext>`，不在数据库中保存 `avatar_object_key` 或头像路径字段。

`passport_user_credentials` 同时保存当前密码和密码历史，不再建立独立的密码历史表。首次设置密码和每次修改密码都新增一条记录，不更新旧记录。每条记录的 `created_at` 表示该密码设置或修改的时间；最新记录按 `created_at DESC, id DESC` 判断。`password` 使用与 `base_system_users.password` 相同的 JSON 结构：包含 PBKDF2-SHA256 编码后的 `hash` 和用于安全分析的 `pattern`，不保存明文密码。管理界面可以显示密码修改时间和特征，但不得显示哈希、JSON 凭据或原密码。

登录时按最新记录到最旧记录逐条校验：匹配最新密码才允许建立 Session；如果只匹配到旧密码，则拒绝登录并提示用户新密码的修改时间，不能继续使用旧密码建立 Session。旧密码记录默认长期保留，除非后续增加明确的密码历史清理策略。

昵称从 Telegram、微信或 Google 身份资料提取，最多 12 个 Unicode 字符；若 Provider 没有可用名称，必须生成不超过 12 个字符的非空系统昵称。Telegram 的 `first_name`、`last_name` 和 `username` 不作为必需的独立字段保存，统一归一化为非空 `nickname`。所有字段必须 `NOT NULL`，可选能力通过独立关联表表达，不使用 `NULL` 或空字符串表示未设置。

由于默认允许多邮箱、多外部身份和多用户关联，`passport_emails.email`、Telegram 账号组合和 OAuth 账号组合不得默认设置为全局唯一；实际登录时如匹配到多个用户，必须提供明确的用户选择或绑定流程。邮箱、Telegram 和其他 Provider 的关联限制通过 Passport 设置项控制，默认不限制。

## 4. Telegram 机器人管理

### 4.1 归属

Telegram 机器人属于平台入口配置，统一归 `global` 管理，不归 Passport 或业务站点管理。

目标数据表：

```text
global_telegram_bots
  id BIGINT PRIMARY KEY
  name TEXT NOT NULL
  bot_token TEXT NOT NULL
  bot_username TEXT NOT NULL
  secret_token TEXT NOT NULL
  status TEXT NOT NULL DEFAULT 'enabled'
  created_at BIGINT NOT NULL
  updated_at BIGINT NOT NULL
```

机器人与域名建议使用独立绑定表：

```text
global_telegram_bot_hosts
  bot_id BIGINT NOT NULL
  hostname TEXT NOT NULL
  status TEXT NOT NULL DEFAULT 'enabled'
  created_at BIGINT NOT NULL
  PRIMARY KEY (bot_id, hostname)
```

绑定域名必须已经存在于 `global_site_hosts`，并指向 `passport` 站点。Webhook URL 不作为机器人表字段保存，而是根据绑定域名、固定路由和 `bot_id` 自动生成，例如：

```text
https://<hostname>/api/tgwebhook?bot_id=<bot_id>
```

同一个 Host 可以绑定多个启用中的机器人，Telegram 请求通过 `bot_id` 查询参数选择机器人；同一个机器人也可以绑定多个 Host。`bot_id` 只用于路由选择，不作为认证凭据，仍必须校验 Telegram Secret Token。同一个用户绑定多个机器人不生成新的 Passport `user_id`。

机器人 Token 和 Secret Token 只能由后端保存和使用，列表接口不得回显完整密钥，编辑接口也不得把密钥作为普通明文初始值返回。

### 4.2 管理功能

global 控制面提供：

- 添加机器人；
- 编辑名称、Token、Username、Secret Token 和状态；
- 选择一个或多个已绑定到 Passport 的域名，由后端自动生成 Webhook URL；
- 启用、停用机器人；
- 删除机器人；
- 设置 Telegram webhook；
- 删除 Telegram webhook；
- 查询 webhook 状态。

所有管理接口都必须在后端校验管理员权限。删除机器人前应检查是否存在依赖；删除操作必须有确认反馈。

### 4.3 机器人与 webhook 关系

机器人配置不复制到 Passport 数据库。Passport webhook 处理请求时：

1. 校验请求方法为 `POST`。
2. 根据请求 Host、固定路径和 `bot_id` 查询参数定位启用的机器人，不依赖 Telegram update 内容识别机器人。
3. 从 `globalDatabase` 读取该机器人的 Secret Token 和配置。
4. 校验 `X-Telegram-Bot-Api-Secret-Token`。
5. 解析 Telegram Update。
6. 使用 `passportDatabase` 处理用户绑定、登录和 Passport 业务。
7. 返回 Telegram 所需的成功或错误 HTTP 响应。

Webhook 处理必须避免把 Token、Secret、密码或验证码写入普通日志。

## 5. Passport webhook

代码归属为：

```text
server/sites/passport/api/tgwebhook.mts
```

请求 Host 应绑定到 `passport` 业务站点。Passport 站点继承 `base` 的通用基础能力，但 webhook 业务代码由 Passport 自己声明和注册。

Webhook 应兼容老项目的核心行为：

- 仅接受 POST；
- 校验 Telegram Secret Token；
- 拒绝无效 JSON；
- 处理 `message` 和 `callback_query` Update；
- 支持菜单、Telegram 账号绑定和邮箱验证码业务；
- 首期不迁移客服功能和 Discourse 集成；
- 异常记录服务端错误并返回通用错误，不向 Telegram 或用户暴露内部堆栈。

Telegram 用户 ID、Chat ID 和 From ID 必须按字符串处理，避免超过 JavaScript 安全整数范围。

## 6. 旧 CouchDB 数据迁移

迁移源文件：

```text
/opt/firadio/php-telegram-iam/couchdb-backup-iam-20260826-005734.json
```

迁移目标为 Passport SQLite 数据库，不导入 global 数据库。旧 CouchDB `_id` 只用于迁移阶段识别文档类型、解析关联键和去重，不作为 Passport 的持久字段保留。迁移必须保留：

- 旧 `userid` 雪花数值；
- Telegram Chat ID；
- 邮箱及验证状态；
- 创建时间；
- 尚未完成的群组授权提示及其状态。

已确认备份包含约 2354 条文档，主要类型包括：

```text
tgfromid
email-tgfromid
email-userid
userid-email
userid-tgfromid
group_prompt
sso
```

迁移程序必须先解析、统计和校验文档，再执行事务导入；重复执行不得产生重复用户或重复绑定。导入后必须验证：

- 每个旧 `userid` 仍能查询到；
- CouchDB `_id` 解析出的关联关系已正确写入 Passport 表；
- Telegram、邮箱和用户 ID 的正反向关系数量一致；
- 旧文档中的时间和验证状态未被意外转换；
- 所有雪花 ID 在 API 中以字符串返回；
- 无 Token、密码或验证码被写入日志。

邮箱和外部身份默认不限制一个用户的绑定数量，也默认不限制同一邮箱、Telegram 或其他外部身份关联的用户数量；相关限制应设计为 Passport 设置项，默认关闭限制。已导入但尚未完成的验证码和群组提示可以长期保留，直到过期或被业务操作清理。

旧项目头像暂不迁移。后续迁移时，头像源目录为 `/opt/firadio/php-telegram-iam/wwwroot/assets/avatars`，旧文件名按 Telegram 用户 ID 保存，需根据旧 `tgfromid` 与 `userid` 关系转换为 `avatars/<user_id>.<ext>`。旧项目配置中的机器人 Token 不属于 CouchDB 备份，机器人配置应通过 global 机器人管理功能单独迁移或重新录入。

## 7. 已确认的业务范围

- Passport 用户必须先通过 Telegram、微信扫码或 Google 建立身份，再绑定邮箱。
- 用户名和密码只能后加，不能用于直接注册；手机暂不实现。
- global 管理员与 Passport 用户完全分离。
- global 管理员继续使用现有 `base_system_users` 和 `base_system_sessions` 后台账号体系。
- 支持多机器人、多域名绑定和一个用户绑定多个机器人，但不因此生成新的用户 ID。
- 机器人必须先停用，且确认没有关联数据后才能删除；历史来源不得被破坏。
- 新用户使用修复后的老项目兼容雪花 ID 生成器，不能使用用户表自增 ID。
- 站点权限由业务站点维护，身份由 Passport 维护。
- 首期实现 Telegram 身份、邮箱绑定和邮箱验证码，迁移菜单、邮箱关系和 Telegram 账号绑定；微信扫码、Google、头像、客服功能、Discourse SSO 和其它 SSO 集成后续实现。
- 所有数据实体统一遵循“先启用/停用，再确认无关联数据，最后允许删除”的生命周期原则；有历史来源或关联数据时只能停用，不能物理删除。

## 8. 实施顺序

1. 建立 Passport 站点代码目录、Passport 数据库 migration 和运行时身份数据库访问上下文。
2. 将 Telegram + 邮箱身份建立、Passport Session 和跨站一次性登录票据迁移到 Passport。
3. 建立 `global_telegram_bots` 及 global 机器人 CRUD 页面和 API。
4. 实现 Passport `/api/tgwebhook`，接入 global 机器人配置和 Passport 数据库。
5. 实现旧 webhook 的菜单、Telegram 账号绑定、邮箱绑定、邮箱验证码和 callback 业务。
6. 编写 CouchDB 到 Passport SQLite 的事务迁移程序。
7. 实现跨站登录、换域名重新登录和业务站点角色校验测试。
8. 执行类型检查、Worker 构建、多站点 Smoke 测试和迁移专项校验。

## 9. 明确不做

- 不在业务站点创建 `site_users`、`site_sessions` 或复制密码。
- 不把机器人 Token 存入 Passport 数据库。
- 不把 OAuth 协议名称当作身份中心站点名称；站点名称统一使用 `passport`。
- 不重新生成旧用户的雪花 ID。
- 不让 Worker 运行时扫描文件系统寻找数据库或 webhook 处理器。

## 10. 验证要求

每个阶段完成后至少运行：

```bash
npm run typecheck
npm run build:worker
npm run smoke:multi-site
git diff --check
```

迁移阶段还必须增加独立的导入计数、关系一致性和重复执行测试。
