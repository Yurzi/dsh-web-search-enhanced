# 升级到 0.1.0

0.1.0 将旧版全局搜索模型配置重构为**会话级搜索连接**。包版本 0.1.0、设置格式 version 2、会话 Storage Domain version 1 是三个不同概念。完整参数见[配置参考](configuration.zh-CN.md)。

## 1. 升级前准备

- 确认 DSH 满足 `>=0.1.5-rc.2`，Node 满足 `^22.19.0 || >=24.0.0`。实现基线是 rc.2 契约，不代表对所有未来宿主版本均完成验证。
- 备份当前插件版本、Web profile / 插件配置和 DSH 持久存储。凭据使用宿主安全备份方式，不复制到公开 Issue 或仓库。
- 记录旧 `modelMode`、协议、模型、endpoint、凭据引用，以及希望保留的会话选择。
- 如旧配置存在非空明文 `apiKey`，**先移到 DSH Credentials，并从配置来源删除**。新插件验证阶段即拒绝明文 Key；如果因此无法挂载设置页，需先在原配置来源处理，不能指望导入按钮替你搬运秘密。
- 自定义 `providerId` 不再支持；安装版固定为 `enhanced-search`。检查旧 Web profile 的 searchProvider 配置和重复安装。

## 2. 安装发行包

从 [v0.1.0 Release](https://github.com/Yurzi/dsh-web-search-enhanced/releases/tag/v0.1.0) 下载构建好的 `dsh-web-search-enhanced-0.1.0.tgz`，使用绝对路径交给 DSH 插件管理器：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-web-search-enhanced-0.1.0.tgz
```

若该版本已在 npm 发布，也可安装固定版本：

```sh
dsh plugin --profile web add dsh-web-search-enhanced@0.1.0
```

发布附件中的构建 tgz 与 GitHub 自动生成的 Source code archive 不同：后者是源码，不能假定含 `lib/` 构建产物。npm 可用性须以 registry 实际发布结果为准，GitHub 标签 / Release 存在不代表 npm 已完成。

安装补丁选择 enhanced-search、禁用默认 web-search-deepseek，并明确将新会话默认设为 Exa；不改 fetchProvider。已有部署请审阅插件管理器反馈和 Web profile，避免重复注册条目，不要用整份示例覆盖所有宿主配置。

升级含服务端与客户端契约变更。重新加载插件或重启 DSH，**然后刷新 Web 页面**；只刷新浏览器不足以更新服务端。此操作可能影响运行中任务，应在合适时机进行。

## 3. 显式导入旧配置与自动迁移脚本

针对老用户的历史配置，插件提供两种迁移方式：**Web 设置页导入**与**命令行自动迁移脚本**。

### 方式一：命令行自动迁移脚本（推荐）

针对已有部署或自动化环境，插件提供了针对老用户的自动迁移脚本。该脚本会自动检测 DSH `settings.yaml`，备份原文件，将遗留的 JSON / flow-style 格式转换为标准 DSH YAML 块级缩进格式，并完成 v1 到 v2 模型的无缝迁移：

```sh
# 预览迁移效果（不修改文件）
node scripts/migrate-config.mjs --dry-run

# 执行自动迁移（自动备份原文件为 .bak）
pnpm run migrate
# 或
node scripts/migrate-config.mjs
```

脚本特性：
- **安全备份**：在对配置文件做任何修改前，自动创建 `.bak` 备份文件。
- **YAML 格式规范化**：自动修复此前设置页或外部写入产生的 JSON 行内花括号 (`flow-style`)，统一输出为符合 DSH 原生规范的标准块级 YAML。
- **旧版路由迁移**：自动将旧版 `modelMode: configured` 转换为 `custom:legacy`，或将 `modelMode: current-session` 转换为 `builtin:session-model`。
- **凭据安全保护**：若旧配置存在明文 `apiKey`，脚本会明确告警并将其从公开配置中剥离，提示移入 DSH Credentials。

### 方式二：Web 界面显式导入

打开设置 → 插件 → Web Search Enhanced。检测到旧 `modelMode/protocol/baseURL/model/apiKeyEnv` 且未标记 version 2 时，显示导入入口。搜索返回 `WEB_SEARCH_MIGRATION_REQUIRED` 是保护措施，不会静默选新默认替代旧路由。

导入前核对 endpoint 与凭据归属，点击“导入旧配置（不迁移或删除 Key）”：

| 旧配置 | 0.1.0 结果 |
| --- | --- |
| `modelMode: configured` 或固定配置 | 新增 `custom:legacy` 固定模型，设为新会话默认 |
| `modelMode: current-session` | 新会话默认设为 `builtin:session-model` |
| `protocol/model/baseURL/apiKeyEnv` | 转为固定连接 binding 的 `protocol/model/baseURL/credentialRef` |
| 模型高级选项 | 固定模式导入到 options；跟随模式按需重新配置 optionsByProtocol |
| `fallbackModel` | 不执行，不变成备用连接 |
| 非空 `apiKey` | 拒绝导入，须先移入 Credentials |
| 已有 `custom:legacy` | 固定模式拒绝覆盖；先重命名已有连接或手动选择其他 ID |

固定模式缺省值沿用旧导入器约定：`anthropic-messages`、`deepseek-flash`、`https://api.deepseek.com/anthropic/v1`、`WEB_SEARCH_ENHANCED_API`。它们不是新的自动 fallback；必须确认目标真实支持搜索。导入器将旧地址标为 trustedEndpoint，因此点击前应检查目标，不能把导入当作安全认证。

UI 以 Settings revision 写入转换结果，并清理用户层的旧路由字段；继承层原配置可能仍保留。导入函数本身只生成对象，不写配置或读取秘密。不要手工仅补 `version: 2` 来“消除错误”，那不会转换旧路由。

**导入只改新会话默认，不覆盖已有会话选择。** 导入后请在已有会话里显式选 `custom:legacy` 或跟随会话模型；新建会话检查默认是否符合预期。多窗口编辑冲突时刷新后重试。

## 4. 从重构预览版升级

已有 version 2 / 会话连接配置不需要再走 V1 导入，但请核对以下变化：

- 四种内置结构化服务均默认 keyless。未显式设置 access 的 Tavily/Tinyfish 将采用当前目录默认；保存的 Key 不会被删除。需要继续使用个人 Key 时明确设 `access: api-key`。
- Exa keyless 不接受非空 options；要保留 `type` 等设置须切个人 Key。
- Tinyfish keyless 仅支持 `domain_type: web/news`，`research_paper` 必须个人 Key。非法 options 即使连接 disabled 也会导致配置校验失败。
- 已有连接 ID 不变，访问方式变化不等于重新选择会话连接。不要以“Key 还在”推断当前走付费接口。
- 老会话记录缺少 freshness 时，仅首次读取补入当时默认；保留原 connectionId（包括 null）和 revision。无需删数据库或重建所有会话。
- defaultConnection / freshness 都是初始化默认，不覆盖已有持久记录。切换连接会保留当前会话的实时性偏好。

## 5. 必须接受的行为边界

- 不再有安装版全局模型 fallback。连接失效、匿名拒绝或付费 Key 失败时明确报错，由用户选择修复方式。
- 跟随模型要求实际 agent 的完整 provider/model，以及 provider 的显式 apiKeyEnv；OAuth、订阅、内联认证、非空自定义 headers 不自动兼容。能聊天不等于能搜索。
- 选择与实时性持久化到 DSH Storage Domain，不使用浏览器 localStorage 代替。配置 / 存储问题不应阻断普通聊天，但搜索会失败。
- 当前请求采用冻结快照；切换后用新的模型请求验证，不用同一步重试判断设置未生效。
- seeded fork 复制初始化时父会话当前值，不重建历史 fork 点。session/disposed 不清除耐久选择。
- 空白会话首消息前没有独立选择器，提前设置新会话默认。
- 实时性不是发布日期过滤；只有 Firecrawl 和 Exa 个人 Key 有当前参数映射，不保证源页面真的最新。

## 6. 升级后检查

1. 确认插件管理器显示目标版本，服务端已加载，浏览器页面已刷新。
2. 新建会话检查默认连接；打开旧会话检查原选择没有被覆盖。
3. 在两个会话分别改变连接 / 实时性，检查互不影响；刷新页面检查保存。
4. 在设置中确认实际访问方式和凭据引用，不以 UI“已配置”替代真实授权测试。
5. 仅在你允许外发查询 / 可能产生费用时，使用一个公开、非敏感词进行搜索，核对返回来源和错误类型；不要把私有文档发送给新供应商做测试。
6. 验证 web_fetch 仍由预期 provider 处理，普通对话模型没有被搜索设置替换。

详细故障表见[配置参考](configuration.zh-CN.md)。发布前自动测试通过不等于你的实例已安装，也不保证当前出口 IP 的匿名访问可用。

## 7. 分支与回退

0.1.0 的开发主线使用 `main`；旧 0.0.x 代码保留在 `legacy/v0.0.x`。旧文档中的重构临时分支不再是默认安装来源。部署优先选择固定版本发行包，而非未固定提交的分支。

回退不是把 version 改成 1：先停止相关任务，使用 DSH 插件管理器恢复已备份的旧版本，再恢复对应旧配置和必要存储备份，重载服务端并刷新页面。旧版不理解新连接模型，不能承诺直接读取 version 2 设置。保留 Credentials；不要为回退随意清空宿主数据库。若恢复原生搜索，还需检查 Web profile 的 searchProvider 与默认搜索插件启用状态。
