# DSH 0.2.0-rc.2 插件适配评估

## 版本与范围

本次对照上游标签 `dsh-v0.2.0-rc.1` 与 `dsh-v0.2.0-rc.2`（提交 `639ed015397290b3745d163aafe02ffee4aa3f84`），结合两份升级评估核查 Web Search Enhanced。插件发布版本为 **0.1.6**，最低宿主 **0.2.0-rc.2**。

- engines.dsh：`>=0.2.0-rc.2`；全部 DSH peer：`^0.2.0-rc.2`；直接开发依赖精确固定 rc.2。
- 更新 pnpm 锁文件与仅针对审阅版本的预发布白名单。开发安装统一 Zod **4.4.3**，运行依赖下限继续为 `^4.4.3`，与上游 rc.2 锁文件一致；不以类型断言规避跨包 schema 类型冲突。
- Cordis **4.0.4**、Include **1.0.9**、Loader **1.0.5**、Schemastery **3.18.4** 在上游未变，不盲目升级。Node 下限保持 `^22.19.0 || >=24.0.0`。
- pnpm overrides 只控制本仓库开发/CI 依赖树，不会强制修改已安装宿主的其他插件依赖。部署应整套对齐 DSH 包，不混装 rc.1 和 rc.2。

## API 与行为结论

| 上游变化 | 本插件影响 / 处理 |
| --- | --- |
| Tools、Web、Settings、LLM 核心实现 | 两标签间只有包版本变化；沿用 Provider、动态配置、会话 projection 与冻结请求快照。 |
| pi-ai 0.87.1 模型目录 | 内置 DeepSeek 目录使用 deepseek-flash，旧 deepseek-v4-flash / deepseek-v4-flash-vision-exp 被移除。跟随目录模式要求当前 ID；回归验证缺失 ID 不自动重写，显式私有路由保留原 ID。 |
| ui-commands 模糊搜索、分组、PopupState 必填字段 | 本插件不手工构造 PopupState，也不替换内置弹窗；现有会话搜索选择器无需新增 props。 |
| TypertGateway.hasLiveClient() | 不实现自定义 Gateway；集成测试使用 rc.2 原生 Gateway，避免旧实现混装。 |
| timed ask_user_question 与迟到回答 | 不提供问答替代 UI/answerer，不把 pending 当授权；无需改变搜索业务。 |
| 定时消息 framing | 本插件不创建提醒或向其嵌入外部搜索结果；无需修改。 |
| OpenInAppAction、侧栏、Client inspect、Shell/ACL | 不调用这些变化接口或脚本，不受直接影响。 |
| 插件升级和 Desktop profile | 已安装插件先卸载再安装；Desktop 先启动一次初始化 profile，并完全退出后执行 CLI。 |

**不自动改写模型配置。** 上游 pi-ai 内置目录的 ID 变化不是所有 Provider 的全局改名。用户需检查默认模型、会话模型、modelOverrides 和子代理配置；私有端点应显式声明实际模型。能聊天不代表搜索连接可用：跟随模式仍需要 API Key 引用，不自动透传 OAuth/账号认证。

## 配置与部署

设置格式仍为 version 2，会话 Storage Domain 仍为 version 1；从 0.1.3–0.1.5 无需新增迁移。不重写宿主 Session 日志，不清空已有凭据或会话搜索选择。备份后先移除旧插件，再安装固定版本，审阅 profile 补丁，重载服务端并刷新 Web 页面。详见[升级指南](migration.zh-CN.md)。

## 验证范围

发布检查使用冻结锁文件，执行 TypeScript Host/Client 类型检查、两端构建、完整 Vitest 测试与真实 tarball 契约校验。新增断言覆盖全部锁定 DSH 包版本、跨包 Zod 解析一致性和 Flash ID 边界；既有集成测试覆盖原生/PTC 请求、Gateway/SessionController、搜索关闭/恢复、设置持久化、fork 与会话隔离。

本次本地执行 `pnpm install --frozen-lockfile && pnpm run check` 退出 0：类型检查、两端构建、21 个测试文件 / 336 项测试和真实安装包契约全部通过。测试使用模拟网络及目录 fixture，不宣称已运行真实 pi-ai 模型或供应商请求。

这些验证不代表升级了用户正在运行的 DSH 实例，也不等于对真实供应商联网、付费认证或 Desktop 原生环境完成验收。上游报告中的 Fetch/Undici 问题属于其他插件，本插件不新增 Undici 依赖。
