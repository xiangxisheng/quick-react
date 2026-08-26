# 云能力管理架构需求

状态：Bucket 一期与阿里云邮件推送一期已实现；腾讯云凭据、Bucket 测试和对象列表已完成真实联调

## 1. 核心原则

云服务统一采用“凭据优先”模型：先选择凭据，后端由凭据确定 Provider，再加载该 Provider 支持的能力和处理模块。任何能力表单都不得要求用户重复选择或提交 `provider`。

```text
选择凭据
  -> 自动确定供应商
  -> 进入对应能力模块
  -> 读取远程资源或填写该能力专属参数
  -> 创建能力资源
  -> 按用途绑定站点
```

选择凭据只表示确定访问身份，不等于启用该凭据支持的所有能力。实际启用的能力由各能力模块创建的资源以及站点绑定决定。

## 2. 管理模块拆分

对象存储、邮件推送、短信、DNS、CDN 和计算服务不得共用一个包含所有字段的“服务管理”表单或通用服务数据表。它们共享凭据优先、Provider 解析、启停状态和站点授权等设计规则，但资源表、绑定表、配置字段与操作界面按能力拆分。

目标导航：

```text
云服务
  凭据管理
  对象存储
    Bucket 管理
    站点绑定
    对象管理
  邮件推送
    通道管理
    模板管理
    站点绑定
  短信服务（后续）
```

对象存储提供 Bucket 发现、文件列表、上传、下载和删除；邮件推送提供发信身份、本地模板、云端模板发布状态和站点用途绑定。能力模块可以共享底层协议工具，但不能通过无关字段污染彼此的表单和数据表。

本项目不实现 SMTP 客户端，也不在后台暴露 SMTP Host、端口、用户名或密码。邮件只能通过已注册的云厂商 HTTP API 发送；未来如需自建 SMTP，由独立 Go 推送服务封装为通用 HTTP Provider 后接入。

## 3. 凭据模型

凭据保存访问身份以及确定该身份作用域所必需的账号上下文：

```text
global_cloud_credentials
  id
  name
  provider
  account_id
  access_key_id
  access_key_secret
  status
  created_at
  updated_at
```

`account_id` 属于访问身份上下文，不属于 Bucket 配置。界面按 Provider 动态显示必要字段：Cloudflare 凭据要求 Account ID，以生成 R2 S3 Endpoint；不需要 Account ID 的 Provider 隐藏该字段。

凭据表单可以选择 Provider，因为 Provider 决定凭据格式；后续所有能力页面只能从凭据推导 Provider。凭据保持精简，不保存 Endpoint、Bucket、发信域名等能力资源配置。Provider 的身份校验与资源发现 API 地址及其推导规则由后端代码注册，不保存到凭据；未来增加自建 Provider 时也先实现并注册对应模块。

## 4. 能力资源数据

不同能力不强行抽象成通用 `global_cloud_services` 表。对象存储的一条可管理资源就是一个已接入的 Bucket，因此直接使用能力专属表：

```text
global_cloud_object_storage_buckets
  id
  cloud_credential_id
  endpoint
  region
  bucket
  path_style
  public_base_url
  extra_config
  status
  created_at
  updated_at

global_cloud_email_channels
global_cloud_email_templates
global_cloud_email_template_publications
global_cloud_email_bindings
global_cloud_sms_channels          # 后续独立设计
```

Bucket 不保存人工名称，也不保存 `provider` 或 `service`。管理界面和站点绑定使用“凭据名称 + 产品名称 + Bucket”生成展示文本，例如“腾讯云生产凭据 / COS / example-1250000000”。

同一凭据可以接入多个 Bucket。默认以 `cloud_credential_id + endpoint + bucket` 标识接入记录，避免同一个 Bucket 被重复添加。Endpoint 是 Bucket 接入配置而不是凭据字段：已知云厂商由 Provider 根据 Bucket 地域推导并自动回填，同时允许在 Bucket 表单中覆盖；自建或其他 S3 兼容 Provider 在 Bucket 表单中填写。

邮件模板以 `template_key` 稳定标识，并用 `template_type` 标识邮箱验证码等业务类型；站点绑定的用途由模板类型自动派生。本地表直接保存当前主题、纯文本正文和 HTML 正文，变量统一写为 `{{variable_name}}`。一期不建立模板版本表；编辑时更新同一条本地模板，并更新各通道对应的云端模板。支持云端模板的 Provider 通过 `global_cloud_email_template_publications` 保存 Provider Template ID 和审核状态；只有状态为 `ready` 的模板才能启用站点绑定。不支持云端模板的 Provider 后续由适配器直接发送本地渲染后的正文，不创建伪造的云端模板记录。

阿里云 DirectMail 支持发信地址发现、`CreateTemplate`、`ModifyTemplate`、`DescTemplate`、`QueryTemplateByParam` 和带 Template Data 的 `SingleSendMail`。新增或修改模板后状态回到 `reviewing`，管理员可以刷新远端状态或把云端模板同步到本地，审核通过后才能设为站点默认模板。模板变量在发布时由内部双花括号语法转换为阿里云语法，日志和 API 响应不得包含 AccessKey Secret、验证码或完整签名参数。

## 5. Provider 与处理模块

`server/cloud/catalog.mts` 集中声明 Provider、可用能力、凭据字段、控制面 API 规则、Bucket Endpoint 推导规则和内部处理模块的映射。后端按“凭据 Provider + 当前能力”解析处理模块，不引入厂商 SDK，统一使用 `fetch`、Web Crypto 和公开 HTTP 签名协议。

Provider 只表示供应商：`aws`、`cloudflare`、`aliyun`、`tencent`、`other`。AWS S3、Cloudflare R2、阿里云 OSS、腾讯云 COS 是对象存储产品，由对象存储模块根据 Provider 自动确定，不作为额外表单选择项。

Provider 可以选择性实现独立的凭据测试。凭据管理统一显示测试 action：已注册测试处理器的 Provider 执行真实校验；`other` 等无法在缺少能力 Endpoint 时独立验证的 Provider，由后端返回“该自定义凭据暂不支持独立测试，请在 Bucket 配置中测试”的反馈。前端不硬编码 Provider key，也不需要 `visible` 或条件协议。每个已接入 Bucket 始终提供 Bucket 测试，用实际的凭据、Endpoint、Region 和 Bucket 验证访问能力。

腾讯云凭据测试使用全局 CAM `GetUserAppId`，不要求凭据保存 Region。测试成功时向管理员显示 UIN、OwnerUin 和 AppId，并在 API 响应中返回对应的非敏感身份信息；不得返回 Secret、签名或完整远程资源列表。

## 6. 站点绑定

对象存储站点绑定引用 `global_cloud_object_storage_buckets.id`。绑定只决定哪个站点以什么用途使用哪个已接入 Bucket，不复制凭据和 Bucket 配置。邮件站点绑定引用邮件通道与本地模板，首期用途为 `email_verification`；每个站点和用途最多一个启用的默认绑定。其他能力建立自己的资源和绑定模型，不通过通用服务表制造跨能力耦合。

同一绑定可以多选用途和默认用途；默认用途必须是用途的子集。每个站点、每个用途最多有一个启用的默认绑定。

## 7. 实施状态

- migration 已合并为新项目初始结构，不保留旧通用服务表。
- 管理导航和 API 已拆为凭据、Bucket、站点绑定和对象管理。
- TableCRUD 已支持条件字段、远程选项、自动回填、多选、手工值和通用游标分页。
- AWS、Cloudflare、阿里云、腾讯云已注册独立凭据测试；`other` 返回明确的不支持反馈。
- 运行时既可以按绑定 ID 加载 Bucket，也可以按站点和默认用途解析 Bucket。
- 自动烟测使用 `other` 验证空库迁移、Secret 不回显、凭据测试反馈、Bucket CRUD、绑定多用途和对象页初始加载。
- 邮件推送已实现阿里云通道、本地模板自动发布、云端审核状态刷新、站点绑定和运行时模板发送；没有 `global_cloud_email_template_versions`。
- 邮件烟测模拟阿里云模板 API，验证变量转换、审核前禁止启用绑定、审核通过后允许默认绑定，以及先停用再删除的生命周期约束。

不把签名代码通过编译或本地烟测等同于厂商联调成功。腾讯云已使用真实凭据验证 CAM `GetUserAppId`、COS Bucket 测试和 ListObjectsV2 对象列表；预签名上传、下载和删除仍需结合实际对象验证。AWS、Cloudflare 和阿里云仍需分别使用最小权限真实凭据完成凭据测试、Bucket 发现、Bucket 测试、对象分页和预签名上传下载验证。
