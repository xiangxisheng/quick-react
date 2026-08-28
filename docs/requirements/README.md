# 需求文档

本目录记录已确认的功能需求和对应的设计决策，按主题命名，实现完成后在文档里更新状态，不删除历史需求。

| 文档 | 主题 |
| --- | --- |
| [backend-driven-ui-and-navigation](backend-driven-ui-and-navigation.md) | 后端驱动页面、导航与表格表单协议 |
| [site-database-routing-and-isolation](site-database-routing-and-isolation.md) | 多站点路由、站点继承与数据库隔离 |
| [passport-and-telegram-integration](passport-and-telegram-integration.md) | Passport 身份中心、Telegram 集成与 OIDC |
| [accounts-account-center](accounts-account-center.md) | Accounts 用户名/密码补全、登录页与账户中心 |
| [cloud-capability-management](cloud-capability-management.md) | 云凭据与云能力管理 |
| [object-storage-management](object-storage-management.md) | 对象存储桶、绑定与对象管理 |
| [optimization-checklist](optimization-checklist.md) | 持续优化清单 |

## 写作约定

- 每个需求文档包含：背景、目标、详细规则、数据结构变更、验收标准。
- 规则写成可验证的条目，避免"优化体验"这类无法验收的描述。
- 相对时间一律写成绝对日期。
- 文档里的"用户"一律指网站终端用户；给 agent 下指令的人称为"主人"，称谓约定见 [AGENTS.md](../../AGENTS.md)。
- 新需求必须先对照既有文档，冲突时在新文档里写明取舍理由。
