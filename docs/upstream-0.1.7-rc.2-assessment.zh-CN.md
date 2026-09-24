# DSH 0.1.7-rc.2 对插件 0.1.4 的影响评估

## 范围与结论

根据上游 rc.1 → rc.2 版本分析，逐项核对本插件实际调用路径，并将开发依赖切换到发布的 rc.2 包验证。上游范围为 [dsh-v0.1.7-rc.1 … dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.7-rc.1...dsh-v0.1.7-rc.2)。本文不是对上游全部提交的重新审计。

结论：升级风险低，未发现需要修改本插件运行时代码的直接破坏性变更；跟随模型存在原有认证与私有 adapter 兼容边界，不能据此承诺所有 Provider 均可搜索。

- 插件：`0.1.3` → `0.1.4`（patch）。
- 最低 DSH：`>=0.1.7-rc.2`；DSH peer 范围：`^0.1.7-rc.2`；直接 DSH 开发依赖：精确 `0.1.7-rc.2`。
- 设置格式仍为 version 2，Storage Domain 仍为 version 1，不重写宿主会话历史。
- 原 Unreleased 中的选择器按需刷新、缓存与并发合并优化一并归入 0.1.4。

## 逐项影响

| 上游变化 | 插件实际依赖与结论 |
| --- | --- |
| 动态工具增删、ToolHistory 与历史投影 | [bridge](../src/dsh/bridge.ts) 只注册 `enhanced-search` Web provider，使用 `agent/request` 和 `tools/execute` 捕获请求上下文；不构造工具增删消息、不重写历史。继续由宿主原生 `web_search` 和 PTC 链执行，无需自行接入投影协议。 |
| DeepSeek Provider 拆分为 API Key / Account 插件 | 依赖、测试和 [安装补丁](../cordis.patch.yml) 均不把旧 `dsh-llm-deepseek` 作为 Cordis 插件加载。补丁中的 `web-search-deepseek` 是原生搜索插件条目，不是被拆分的 LLM 插件，不能误改成新 Provider 包名。用户自行维护的宿主 profile 仍需按上游规则迁移。 |
| `selectModel` 严格校验 `listModels` | 插件不调用 `selectModel`，也不通过切换聊天模型执行辅助搜索。[跟随模型](../src/dsh/session-model.ts) 读取实际请求头与公开配置目录；固定模型直接使用显式 binding。因此不是所有固定搜索模型都要注册到宿主。用户切换聊天模型时则须确保模型在宿主目录中，否则会先被宿主拒绝。 |
| Schedule 存储导出删除、默认禁用 schedule/time-context | 插件不依赖 Schedule 或时间上下文服务。自身选择存储通过 Storage Domain，不涉及计划任务存储；实时性参数是缓存年龄偏好，也不依赖注入时钟。 |
| `PreToolDecision.displayReason`、Auto Review 调整 | 插件不构造该准入决策，不接管审批；`tools/execute` 钩子继续调用 next，保留宿主授权与审批链。新增可选展示字段无需适配。 |
| 快捷键中心、代码语言与系统提示词调整 | 插件不导入旧快捷键内部 API、不使用代码语言内部模块、不解析系统提示词。设置页、会话 projection 与插件配置槽的类型和构建由 rc.2 依赖验证；不能以编译通过替代真实 GUI 验收。 |

## 跟随模型边界

[session-model.ts](../src/dsh/session-model.ts) 仍通过 `listConfigurableProviders()` 的 settings namespace/path 获取非秘密路由信息，要求受支持的 HTTP 协议、endpoint 和显式 `apiKeyEnv`。官方账号、OAuth、订阅凭据不会被重建或借用。新官方 API Key Provider 也不能仅因包名包含 API Key 就视为自动兼容，仍须满足这些路由条件。

adapter identity 的 `registration()` 及可选 pi-ai catalog 是原有兼容 shim，并非稳定公共契约；缺失或发生替换时保持 fail-closed，不隐式改用其他连接或凭据。遇到跟随不可用可显式选择内置结构化连接或受支持的固定搜索连接。

## 升级与验收

先升级 DSH，再安装 0.1.4，重新加载服务端插件并刷新 Web 页面。从 0.1.3 升级应保留连接选择、凭据和实时性偏好，无需清空存储。选择器不再常驻两秒轮询；跨窗口修改在后续缓存过期的按需刷新时同步。

本次验证通过：冻结锁文件安装、TypeScript 类型检查、服务端 / 客户端构建、22 个测试文件共 339 项测试，以及 0.1.4 实际打包契约检查。执行命令为 `PNPM_HOME="$PWD/.pnpm-home" pnpm install --frozen-lockfile` 与 `PNPM_HOME="$PWD/.pnpm-home" pnpm run check`；显式设置工作区 PNPM_HOME 是为解决本机默认 pnpm 状态数据库打开失败，不是插件运行要求。自动测试使用模拟网络，不证明外部搜索服务实时可用；本次版本更新不等于 npm/GitHub 发布，也不等于运行中的 DSH 已安装新版本。
