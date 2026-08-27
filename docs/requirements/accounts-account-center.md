# Accounts 用户名、密码与账户中心需求

- 提出日期：2026-08-27
- 状态：已实现（2026-08-27）
- 涉及范围：`base` 站点角色对照表、`passport` 站点与 `accounts_identity` 模块
- 上游需求：[passport-and-telegram-integration](passport-and-telegram-integration.md)（本文档遵循其中的身份模型与表结构约定）

## 背景

1. 后台"用户管理"的角色字段是自由文本框，管理员要手工写 `["admin"]`，既容易写错也看不到系统里有哪些角色。角色与代码里的导航、接口守卫强绑定，属于不随数据变化的常量。
2. Accounts 注册在邮箱验证通过后直接建号登录，用户没有用户名、也没有密码，后续只能依赖 Telegram 或第三方登录。上游需求已明确"用户名和密码只能在身份建立后作为附加登录方式设置"，但补设入口一直没有实现。
3. Accounts 登录页要求先选登录方式再输邮箱；邮箱没注册时只回一句"未找到该邮箱对应的可用 Telegram 登录身份"，用户不知道下一步该做什么。
4. `setPassportPassword` / `verifyPassportPasswordHistory` 已按上游需求实现，但没有任何调用方；个人中心只有静态文案，昵称、邮箱、密码都没有维护入口。

## 目标

- 角色在代码里集中定义并带中文名，用户管理用多选展示为"管理员(admin)"。
- Accounts 用户必须有用户名；密码可选，但未设置时每次登录都提醒。
- 登录页以邮箱为入口，未注册邮箱给出确认与注册引导。
- 账户中心（昵称、邮箱、密码）集中在 Accounts 站点，业务站点只读展示并跳转。

## 一、角色对照表

- 角色常量定义在 `shared/types/role.mts`，前后端共用，不进数据库。
- 字段：`value`（英文键）、`label`（中文名）、`assignable`（能否在用户管理里分配）、`description`。
- 当前角色：

  | value | label | assignable | 说明 |
  | --- | --- | --- | --- |
  | `public` | 访客 | 否 | 任何请求隐式拥有 |
  | `user` | 登录用户 | 否 | 已登录用户隐式拥有 |
  | `accounts` | Accounts 用户 | 否 | 存在 Accounts 会话时隐式拥有 |
  | `admin` | 管理员 | 是 | 管理后台准入角色 |

- 展示统一为"中文名(英文键)"；未登记的历史角色原样显示并标注"未知角色"。
- 用户管理的角色字段是多选下拉，选项只来自 `assignable` 的角色；存储格式仍是 `base_system_users.roles` 的 JSON 文本，由接口层负责数组与文本互转并拒绝白名单外的角色。

### 验收标准

- 新增/编辑弹窗里角色是多选，选项显示"管理员(admin)"；列表列显示中文标签。
- 提交 `user`、`public` 或未登记角色返回 400。
- 个人中心的角色展示使用同一套标签。

## 二、Accounts 用户名（必填、不可自助修改）

上游需求规定"所有字段必须 NOT NULL，可选能力通过独立关联表表达"，因此用户名不加在 `passport_users` 上，而是独立关联表：

```text
passport_usernames                      -- 用户设置用户名后才创建
  user_id BIGINT PRIMARY KEY
  username TEXT NOT NULL UNIQUE
  created_at BIGINT NOT NULL
```

- 格式：小写字母开头，只允许小写字母和数字，长度 6–12，正则 `^[a-z][a-z0-9]{5,11}$`。
- 业务站点由 OIDC 建立的本地账号，在 Accounts 用户名设置之前使用 `passport_<user_id>` 作为占位用户名；因为占位名带下划线，永远不可能等于合法用户名，所以"用户名不符合规则"本身就代表还没设置。
- Accounts 用户名一旦设置，会通过 OIDC 的 `preferred_username` 声明下发，业务站点在下次登录时把占位用户名同步改写；管理员手工改过的用户名不覆盖。
- 历史导入或占位的用户名（不符合规则）在登录时必须先改成合法用户名才能继续，提示文案要说明当前用户名不符合规则。
- 保留名单：`admin`、`root`、`system`、`support`、`official`、`passport`、`accounts`、`service`、`security` 不允许被普通用户占用。
- 每次 Accounts 登录成功后，如果还没有用户名，必须先设置才能进入目标站点，**不提供跳过**。
- 合法用户名设置后不允许自助修改（避免历史引用错乱），账户中心只展示；不合法的历史用户名可以改写一次。

### 验收标准

- 新注册用户在邮箱验证通过后立即进入"设置用户名"步骤。
- 历史用户（没有用户名）下次登录时同样被要求设置。
- 大写、下划线、数字开头、长度越界、保留词、已被占用都返回明确的中文错误并停在该步骤。
- 设置成功后才继续跳转到原目标（包括 OIDC 授权回跳）。

## 三、Accounts 密码（可跳过，每次登录提醒）

- 设置用户名之后，如果还没有密码，展示"设置密码"步骤：密码 + 确认密码，两次必须一致，长度至少 8。
- 该步骤提供"跳过"按钮；跳过只对本次登录生效，下次登录仍会提示。
- 设置成功后提示：下次可以直接用邮箱 + 密码登录。
- 已设置密码的用户不再出现该步骤。
- 写入复用 `setPassportPassword`（`server/passport/identity.mts`），保留密码历史。
- 邮箱 + 密码登录复用 `verifyPassportPasswordHistory`：只匹配到旧密码时拒绝登录，并提示新密码的修改时间（遵循上游需求）。

### 验收标准

- 未设置密码的用户每次登录都看到该步骤，点击跳过可直接进入目标站点。
- 设置密码后再次登录不再提示，且可以用邮箱 + 密码登录。
- 用旧密码登录被拒绝并给出新密码的修改时间。

## 四、Accounts 登录页

### 两条铁律

1. **只要需要发送邮件（验证码），都必须先完成第三方认证**（Telegram / 微信 / Google），认证通过后才允许发码。注册和账户中心里的绑定新邮箱都适用。
2. **登录的必要条件是"已绑定邮箱 + 第三方认证"或者"邮箱 + 密码"**，两者取其一。

### 页面结构

登录页是**一个邮箱输入框加下一步按钮**，第三方登录以图标链接的形式排在下方（`formPage.externalLogins`，前端按 key 渲染品牌图标），用户可以任选一条路走：

- **输入邮箱 → 下一步**：后端判断邮箱是否已注册。
  - 已注册且设置过密码 → 进入密码登录（附"忘记密码""换个邮箱"两个动作，页面下方仍然保留第三方入口）。
  - 已注册但没设置过密码 → **不给密码输入框**，直接引导用第三方登录，并说明登录后可以在账户中心设置密码。
  - 未注册 → 进入确认步骤，文案为"{email} 还没有注册，请确认邮箱地址是否正确"；确认无误后把邮箱暂存 30 分钟并选择一种第三方认证方式，认证通过才会发送验证码并创建账号。
- **直接点第三方按钮**：
  - 微信 / Google → 跳转外部授权；返回的身份已绑定邮箱就直接登录，没有邮箱就用暂存邮箱走验证码绑定。
  - Telegram → 输入已绑定邮箱 → 选择 Telegram 账号 → 消息批准登录。
- **忘记密码**：点"忘记密码"记录重设意图并要求先完成一次第三方认证（含 Telegram 批准）；认证通过后直接给出"设置新密码"步骤，不需要输入旧密码，设置完成后继续原来的跳转。

### 登录后补全顺序

用户名（必填，不可跳过）→ 重设密码（仅在走了忘记密码流程时）→ 设置密码（没有密码时提示，可跳过，跳过只对本次登录生效）。

### 业务站点不得自动跳转到 Accounts（硬规则）

**任何情况下，业务站点都不允许在用户不知情时跳转到 Accounts。** 只有用户看到提示并主动点击后才能发生跳转：

- **登录只在弹窗里完成，不保留整页跳转**：`passportLogin` 协议里既没有 `autoStart` 也没有 `mode`，`passport.js` 只有弹窗一条路径。
- 需要登录的地方（头部登录按钮、401 提示页）直接弹出 Accounts 登录窗口，不再把用户送去登录页；后端用 `action: 'accounts-login'` 表达这一点，业务站点因此不需要专门的登录页跳转。
- 业务站点登录页保留为兜底入口：展示说明文案和一个按钮，点击才会弹窗；页面加载时不发起任何登录请求。启用 Accounts 登录后本地注册入口一并隐藏（本地注册本来就会被拒绝）。
- 弹窗登录成功后，OIDC 回调直接返回"关闭窗口"的页面并通知打开方，不再中转到 `/accounts/oidc/popup` 这类额外页面。
- 弹窗里的**取消登录就是关闭窗口**；只有在非弹窗场景（窗口关不掉）才回落到来源站点，来源地址取自数据库里已注册的 `redirect_uri` 的 origin，不接受外部传入，避免开放重定向。
- 业务站点个人中心的"前往账号中心"在**新标签页**打开，原页面不会离开。
- 从业务站点跳来的 Accounts 登录页会说明"正在为 <来源域名> 登录"。

### OIDC 回跳约束

- 业务站点通过 `/api/oidc/authorize` 登录时，如果账号还没有合法用户名，同样要先回登录页补全，不能直接发授权码。
- 密码是可跳过项，**不在 authorize 处拦截**，否则跳过后会在登录页和授权端点之间来回跳。
- 补全步骤会延长登录耗时，而 `passport_oidc_authorization_requests` 与 `accounts_oidc_request` cookie 的有效期都是 10 分钟。进入补全步骤时必须同时续期数据库行和 cookie；最终跳向 `/api/oidc/authorize` 的那一步仍然要清除 cookie。

### 验收标准

- 登录页同时出现邮箱输入框和第三方按钮。
- 未注册邮箱不返回 404，而是进入确认步骤，且在完成第三方认证之前不会发出任何邮件。
- 已注册邮箱进入密码登录；密码错误的提示里说明可以用第三方认证重设。
- 忘记密码必须先完成第三方认证才能设置新密码。
- 已登录但没有用户名的账号访问业务站点时被挡回登录页补全。

## 五、账户中心

参考 Google 的做法：账号设置集中在 Accounts，业务站点只做只读展示并跳转。

### Accounts 站点（passport）

- 需要登录的页面统一放在 `/panel` 下，账户中心的路径是 `/panel/accounts`（对应 `/api/panel/accounts/*`）。
- 存在 Accounts 会话的请求追加 `accounts` 角色，导航"账户中心"用 `roles: ['accounts']` 控制可见性；头部身份区显示昵称，并提供"账户中心"和"退出 Accounts"。
- Accounts 站点覆盖 `/api/panel` 守卫，让 `user` 或 `accounts` 任一会话都能进入 `/panel`，`/api/panel/accounts/*` 再单独要求 Accounts 会话。
- 页面：
  - **概览**：用户名、昵称、主邮箱、已绑定身份数、密码状态。
  - **个人资料**：修改昵称（最多 12 个 Unicode 字符，去掉首尾空白，不允许为空）。
  - **邮箱管理**：邮箱列表（主邮箱、验证状态、绑定时间）；设为主邮箱；解绑。主邮箱和最后一个邮箱不允许解绑。
  - **绑定邮箱**：独立页面。没有第三方认证凭证时只展示认证入口，认证通过后才允许输入邮箱、发送验证码并完成绑定（对应第四节的铁律 1）。第三方认证凭证有效期 30 分钟。
  - **安全设置**：设置或修改密码；已有密码时必须先验证当前密码。
- 新增邮箱验证码表，与既有 OTP 表保持一致的字段与限流策略：

```text
passport_user_email_otps                -- 已登录用户添加邮箱时的验证码
  id TEXT PRIMARY KEY
  user_id BIGINT NOT NULL
  email TEXT NOT NULL
  code_hash TEXT NOT NULL
  attempt_count INTEGER NOT NULL DEFAULT 0
  status TEXT NOT NULL DEFAULT 'pending'   -- pending / used / expired
  expires_at BIGINT NOT NULL
  created_at BIGINT NOT NULL
  updated_at BIGINT NOT NULL
```

- 限流沿用既有策略：同一用户 60 秒一次、1 小时最多 10 次；验证码错误 5 次锁定。
- 绑定成功时若用户当前没有主邮箱，则新邮箱设为主邮箱，否则为普通邮箱；设为主邮箱是显式操作，需要把旧主邮箱降级（当前代码从未维护过 `is_primary`，本次补齐）。

### 业务站点（base 个人中心）

- 保留只读展示（用户名、角色）。
- 站点启用了 Accounts 登录时，增加"前往账号中心"的链接，指向 Accounts 站点的账户中心。

### 验收标准

- 未登录 Accounts 看不到"账户中心"导航，登录后可见。
- 昵称、密码可以修改并即时生效。
- 添加邮箱必须通过验证码才能绑定；绑定后可设为主邮箱，设主邮箱会把旧主邮箱降级。
- 解绑主邮箱或最后一个邮箱返回明确错误。

## 数据结构变更

1. 新表 `passport_usernames`。
2. 新表 `passport_user_email_otps`。
3. `base` 侧无结构变更。
4. 迁移需要同时提供四份：`migrations/passport/`（sqlite）、`migrations/postgresql/passport/`、`migrations/mysql/passport/`、`migrations/d1/`（扁平合并序列），并同步 `prisma/passport.prisma`。

## 不做的事

- 不做角色的数据库化管理界面（角色与代码强绑定）。
- 不做 Accounts 用户名的自助修改。
- 不改动 base 站点本地账号（`base_system_users`）的既有登录逻辑。
- 不实现手机号绑定与头像（沿用上游需求的范围）。

## 实现说明（2026-08-27）

- 角色对照表在 `shared/types/role.mts`，用户管理的角色列改为多选；`base_system_users.roles` 仍存 JSON 文本，由接口层转换。
- 用户名存放在独立表 `passport_usernames`，密码沿用 `passport_user_credentials`，都遵循"可选能力用独立关联表"的约定。
- 补全流程在 `server/accounts/onboarding.mjs`，登录成功后由 `/api/accounts/sign` 继续返回 `formPage`；第三方 OAuth 回调改为先跳回登录页补全。进入补全步骤时会给 OIDC 授权请求和 cookie 续期。
- 通用 `FormPage` 的自定义 action 现在也会应用响应里的 `formPage`/`currentValues`/`redirectTo`；只要响应里带 `formPage` 就不再安排跳转，修掉了多步表单被反馈倒计时带走的问题。
- 账户中心概览用 `dashboard` 组件（统计 + 账户信息表），邮箱管理用 `table` 组件：工具栏"添加邮箱"发送验证码，工具栏"输入验证码"完成绑定（通用抽屉的新增表单只有一步，验证码必须作为独立动作）。
- 待验证邮箱以只读行的形式出现在邮箱列表里，数据来自 `passport_user_email_otps`，不写入 `passport_emails`。
- 业务站点的个人中心由 `accounts_oidc_client` 模块覆盖 `/api/panel/me`，启用 Accounts 登录时下发指向 `<issuer>/panel/accounts` 的链接（不带页面后缀，由 Accounts 站点跳转到规范地址），页面上不再重复本站的占位说明。
- 覆盖测试：`npm run test:user-roles`、`npm run test:accounts-center`，以及扩展后的 `npm run test:accounts-external`、`npm run test:passport-login`。

## 分离部署约束（2026-08-27 补充）

global、passport 和业务站点会分别部署，数据库也各自独立，因此：

- Accounts 的身份判断（用户名、密码、邮箱、验证码）全部只读写 passport 数据库，不依赖 global 或业务库。
- 业务站点不读 passport 数据库，只通过 OIDC 的 `sub` 和 `preferred_username` 声明获得身份信息。
- 仍然跨库的是既有能力：Telegram 机器人配置（`global_telegram_bots`）和邮件通道、模板、云凭据（`global_cloud_*`）来自当前部署的 global 表。**独立部署 passport 时，这些配置必须配在 passport 所在部署的 global 表里**，否则发不出验证码、也列不出 Telegram 登录方式。
- 回归测试 `npm run test:accounts-split-database` 用独立 passport 数据库覆盖上述结论。

## 文案约定（2026-08-27 补充）

用户可见文案一律使用正式书面语：用"更换/点击/请/尚未/可使用"，不用"换个/点/还没有/可以直接用"这类口语，也不出现"不登录了"这种表述。
