# DSH 0.2.0-rc.1 对插件 0.1.5 的影响评估

## 范围与结论

对照本地上游源码的 `dsh-v0.1.7-rc.2` → `dsh-v0.2.0-rc.1` 差异，目标提交为 `4878cdabd87d4041bdaff61d04c966883b9fd07a`。重点核对插件实际使用的服务、事件和客户端插槽，不将上游版本摘要直接等同于插件兼容性结论。上游完整范围见[版本比较](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.7-rc.2...dsh-v0.2.0-rc.1)。

**结论：必须更新依赖约束与构建基线；本次核对未发现必须修改搜索业务代码的接口破坏。** DeepSeek 账号搜索是原生 provider 的新能力，不会自动传递给本插件。

- 插件：`0.1.4` → `0.1.5`（延续本项目兼容性更新的 patch 版本惯例）。
- 最低宿主：`engines.dsh >=0.2.0-rc.1`。这是用户所指 `0.2.0rc.1` 的上游规范版本号。
- 所有直接 DSH peer：`^0.2.0-rc.1`；所有直接 DSH 开发依赖：精确 `0.2.0-rc.1`。同步更新锁文件、预发布安装白名单、版本断言和安装文档。
- 设置格式仍为 version 2，会话 Storage Domain 仍为 version 1；不增加配置迁移或改写宿主 Session 日志。

## 逐项影响

| 上游变更 / 核对点 | 对本插件的影响与处理 |
| --- | --- |
| `0.1.x` → `0.2.x` 版本范围 | 旧 peer `^0.1.7-rc.2` 不接受 `0.2.0-rc.1`。不能只修改 engines 或简单放宽上界，必须显式纳入目标 prerelease；本次同步提升 peer 下限和开发基线。 |
| [WebSearchProvider / WebError](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/web/web/src/types.ts)、WebRuntime、tool-web | 对应源码在两 tag 间未变化。继续通过 `registerSearchProvider` 服务原生 `web_search`，请求 / 来源 / 取消接口不变，也不接管 `web_fetch`。 |
| [默认 bundle 的 web 条目](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/bundle/base/cordis.patch.yml) | `web`、`web-search-deepseek` 仍存在，本插件补丁不需要改 ID，仍选择 enhanced-search 并禁用原生搜索，不设置 fetchProvider。 |
| [原生 DeepSeek 搜索账号认证](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/web/web-search-deepseek/src/index.ts) | 原生 provider 根据当前会话 requestContext 的 deepseek-account 路由解析受端点限制的账号 token。本插件没有调用这条认证链；结构化 / 固定 API Key 连接继续独立工作，跟随模式仍拒绝无法解析为显式 apiKeyEnv 的账号 / OAuth 路由。本次不隐式借用账号 token，也不自动切换 provider。 |
| [ConfigEditor 继承配置计算修复](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/boot/config-editor/src/index.ts) | 宿主区分有无用户 config 覆盖，并使用组合后的继承配置；影响设置继承值的正确呈现，而非插件字段协议。继续使用 SettingsForms / ConfigForms 和 revision CAS，遵循 Cordis 的 config 对象替换语义；修改单字段时宿主可能携带继承字段，恢复到完整继承值后删除用户 config 覆盖。 |
| SettingsForms / ConfigForms、Typert、会话 projection、存储 | 插件使用的核心契约和 plugins.bundle.config 插槽未变化；api-remotes 新增 product analytics contribution，不改变插件 `$mount` 顺序或连接失效处理。会话 fork 新增可选 onCreated 回调，不影响插件的 seeded fork 选择继承。 |
| [AgentLoop 工具结果恢复](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/core/agent-loop/src/agent.ts) / [ToolCallRecovery](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/core/session/src/repair.ts) | 失败步骤会补齐尚无已提交结果的调用。插件只经过 agent/request、tools/execute 和 provider 返回结果，不自行写 tool/call、tool/result 或 surfaceOp，因此无需补造事件或重试搜索。调用是否已完成仍以宿主恢复语义为准。 |
| Schedule / time-context / ui-schedule 从 Web 默认组合抽离 | 插件补丁和服务注入不引用这些 ID / API；无需新增实验 bundle。用户自己的 profile 如引用旧条目，应独立迁移。 |
| runNativeCommand 新增必填 window 参数 | 插件不直接调用该 API；升级后的传递依赖由上游负责适配，无需增加 native-command 依赖。 |
| OTel 服务集中化、Desktop 产品埋点、日志上传设置 | 插件未注入 otel，也不新增遥测调用；不因本次升级添加上传行为。但搜索工具结果仍属于宿主会话内容，是否上传由宿主日志 / 隐私设置决定，不能据插件无遥测推断宿主完全不上传。 |
| 默认 detailed 视图、运行状态动画、插件管理器交互及主题细节 | 插件不替换 transcript 或 composer，只追加 conversation.input.right 和插件配置槽。未发现槽契约破坏；实际运行实例的视觉验收仍需安装新版后刷新页面。 |

跟随模式仍保留受限的非公开 adapter identity / catalog 兼容层（见 [session-model.ts](../src/dsh/session-model.ts)）；相关 LLM 源码在本次 tag 差异中未改变，不代表未来版本保证兼容。形状不匹配时继续 fail-closed，可改用显式固定连接。

### SemVer 注意

`0.2.0-rc.1` 在版本排序上小于 `0.2.0`，但默认 npm SemVer 范围匹配另有 prerelease 排除规则。因此 `>=0.1.7-rc.2 <0.3.0` 也不能仅靠放宽上界就接受 `0.2.0-rc.1`。本次使用 `^0.2.0-rc.1` 明确纳入目标预发布，同时将 peer 上界限制在 `<0.3.0-0`。该范围不代表自动支持所有未来小版本的预发布，也不代表所有 0.2.x 已经测试。

## 升级与验证

先升级 DSH，再安装插件 0.1.5，重载服务端插件并刷新 Web 页面。保留现有凭据、搜索连接、会话选择和实时性偏好，不需要清空存储。需要 DeepSeek 账号搜索时不能把“宿主账号能聊天”等同于“本插件跟随模式能搜索”；应继续使用支持的独立连接，或明确恢复原生 provider 和对应 profile 选择。

本轮验证（2026-09-29）：

- `PNPM_HOME="$PWD/.pnpm-home" pnpm install --frozen-lockfile --offline`：通过，锁文件可复现本次已缓存的依赖安装。
- `PNPM_HOME="$PWD/.pnpm-home" pnpm run check`：退出 0；TypeScript 类型检查、服务端 / 客户端构建、22 个测试文件共 340 项测试、0.1.5 实际打包 / 解包契约检查全部通过。
- 新增真实 Loader / ConfigEditor 回归用例，覆盖继承默认值、单字段修改、重启恢复和 unset 恢复默认；按宿主 config 对象替换语义验证，未修改业务源码。
- 20 项 DSH peer、32 项直接 DSH 开发依赖、72 个锁定 DSH 包和预发布白名单已核对一致；锁文件中不残留旧 DSH 版本或镜像 tarball 地址。
- `git diff --check`：通过。

安装环境说明：npm 官方 registry 本次发生 TLS / ECONNRESET 连接错误，依赖更新改用一次性的 `--registry=https://registry.npmmirror.com` 完成，并通过 pnpm supply-chain 检查；没有修改默认 registry 或关闭校验。随后以离线冻结安装和完整 check 验证。工作区 PNPM_HOME 仅为本机缓存 / pnpm 状态目录配置，不是插件运行要求。

自动测试使用模拟网络，不证明搜索供应商实时在线；本次未进行运行实例的浏览器视觉验收或安装 / 重载，也未发布 npm/GitHub Release。打包契约检查使用临时包并在完成后清理，不提供持久发行附件。
