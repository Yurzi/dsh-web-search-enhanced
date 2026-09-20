# V2 实施记录与未闭环项

## 结论

已实施 V2 首版插件侧功能，包括恢复并接通旧版已有的跟随会话模型能力。跟随使用 Session request header + DSH settings + Credentials，不再一律报宿主不支持。首版支持显式 apiKeyEnv 的普通三协议 HTTP 路由；特殊认证/headers 明确拒绝。空白会话首条消息前选择、耐久删除和历史 fork 完整目标仍需宿主配合。没有全局 activeProfile、fetch 包装、DOM 劫持或 composer 替换。

工作分支 refactor/search-connections-v2；原准备提交 d3d857a、检查点 99f027c 和 baseline/search-connections-v2 标记未移动，main 未修改。未 push、未发布、未变更版本号。用户确认禁用当前 linked 插件之后才构建 lib；没有重新启用、没有修改宿主配置/代码。

## 实施提交

| 提交 | 内容 |
| --- | --- |
| df48f82 | Catalog、严格稀疏配置、会话选择串行初始化/CAS、不可变请求上下文 |
| ce7b336 | Firecrawl/Exa/Tavily/Tinyfish、受控 HTTP、共用模型执行层 |
| 9585ad4 | 真实 DSH 存储/授权 Remote/Provider/原生与 PTC 接线、输入区 UI、迁移、诊断和集成测试 |
| a3155a2 | 恢复 settings-first 跟随解析，接入实际 Session header/快照/Remote/UI；新增 62 项回归，共 172 测试 |

文档通过后续独立提交保存，实际哈希以 git log 为准。

## 功能矩阵

| 用户目标 | 实际状态与主要代码 |
| --- | --- |
| Session 独立组合对话模型 × 搜索连接 | **已有 Session 已接线**；src/client/index.tsx 只追加 conversation.input.right，不动模型单槽。空白会话见宿主缺口 |
| 会话选择持久化、恢复、多窗口冲突 | src/dsh/session-selection.ts + bridge.ts；DSH Storage Domain 的原子 update，持久成功后确认；客户端 5 秒/focus 刷新与版本冲突后刷新 |
| 固定模型与协议 | 三协议复用 src/protocols.ts；固定模型不受传入会话 binding 变化影响；没有 fallbackModel 路由 |
| 跟随会话模型 | src/dsh/session-model.ts + bridge.ts：实际 header 优先、settings-first、可选目录补齐、按 step 冻结、按 provider/model 缓存、adapter 替换拒绝；缺引用/特殊认证/headers 明确不支持，无 fallback |
| 四个结构化后端 | src/adapters/structured.ts；认证、规范化、空结果、数量上限、限流、取消、错误脱敏均有 fixture 测试；无真实账号调用 |
| 内置 Catalog、Key-only、DSH Credentials | src/catalog.ts、V2Settings.tsx；describe 无密钥可用性，set 只写 Credentials；每次执行 resolve，无跨操作密钥缓存 |
| 稀疏覆盖、重置、自定义实例 | 严格白名单，内置身份/地址不能偷换；自定义地址信任确认；比较 composition base 保存差异，reset 不删 Key |
| 顶层 freshness | 三档跨连接保留，冻结到请求；Firecrawl/Exa 映射原生缓存控制，其他后端忽略，不用发布日期或搜索深度冒充 |
| 新鲜内容与诊断 | Firecrawl 内联 markdown，Exa 有界来源 text；有界 snippet，不额外模型总结；私有最多 100 条 requested/default/applied/ignored/partial 诊断，无查询/URL/Key，不扩展 DSH 输出或 Session event；freshnessVerified 始终 false |
| 会话隔离、请求快照、重试、多查询/PTC | WeakMap agent+turn+step 去重，tools/execute 的真实 exec.agent 进入私有 AsyncLocalStorage；缺上下文/HMR 进入旧请求时明确失败 |
| 取消与错误 | 凭据等待可取消、HTTP+响应读取可取消，90 秒超时、2 MiB 响应上限、重定向拒绝；区分凭据、跟随不支持、HTTP 认证/权限/限流、传输、取消 |
| 迁移 | 显式导入旧固定/跟随配置；不复制明文 Key、不执行旧 fallback、不覆盖已有 custom:legacy；旧自定义连接保留；导入不覆盖已有 Session |
| fork / 删除 / 导出 | lazy fork 复制父当前选择，之后独立；**历史 fork 边界与插件状态随原生导出未实现**；无真正 durable-delete hook，保留 orphan，不错误监听 session/disposed 删除数据 |

## 真实宿主证据（不是设计里的拟议 API）

以下相对路径位于 /usr/lib/deepseek-harness/node_modules/@deepseek-ai/，仅阅读：

- dsh-agent-loop/lib/index.js:1008–1031,1088–1098,1143–1158：同 turn/step 重试会再次执行 agent/request；必须保留选择快照。
- dsh-agent-loop/lib/index.js:1166–1217：header 仅在初始/变化/系列时写入；header revision 不是每次 attempt 的身份。
- dsh-llm-pi-ai/lib/index.js:1750–1773,1817–1838,1867–1874：prepareCall 有自己的 snapshot。此前据此把全部跟随模式禁用是过度限制，已纠正为在 agent/request 读取无密钥 settings 快照，而非执行时重读最新 settings；不声称取得宿主私有 prepared handle。
- dsh-llm-pi-ai/lib/types/config.d.ts:53–80、catalog.d.ts:257–291：协议/地址/凭据属于 provider；model entries/modelOverrides 没有这些字段。只读 config.profiles().get(provider).piProvider.getModels() 用于缺省目录补齐，非强制依赖。
- dsh-llm-pi-ai/lib/types/auth.d.ts:19–59：scoped credential records/OAuth/ambient auth 是另一认证路径，本首版不重建；需要显式 apiKeyEnv。
- dsh-tools/lib/index.js:1207–1219,1264–1275,3209–3214：PTC 子分派保留 exec.agent/rootCallId，走真实工具执行钩子。插件不向 exec 塞入不存在的 search 字段。
- dsh-api-session-controller/lib/index.js:183–199,368–401：真实 Session/Agent 解析与 subagent ownership 策略；插件 Remote 调用 resolveAgent，不以会话 ID 或 cwd 自行代替授权。
- dsh-storage-domain/lib/index.js:198–225,257–285：写入串行化，耐久写入在内存状态之前。Domain 名称实际要求下划线，不使用设计示意中的连字符。
- dsh-session/lib/types/index.d.ts:29–50：session/disposed 包含离开 live store/发布回滚，不能等同耐久删除。
- dsh-client-ui-conversation/lib/client.js:14369–14387,16178–16184：真实列表槽注册方法及无 sessionId 时不渲染的门控。
- dsh-api-session-controller/lib/types/types.d.ts:252–258：Session 创建参数没有插件草稿 handoff。

插件新增 searchConnections.get/set 是自己的 TypertRemoteService + @Remote，使用公开 client $mount contribution。未声称 DSH 原本存在 selectSearch、effectiveSearchRoute 或 draftSearch 参数。

## 验证

基线：本地 tsc 通过，7 文件 / 48 测试通过。pnpm run 在启动阶段 unable to open database file，和交接一致。

当前源码：

- ./node_modules/.bin/tsc -p tsconfig.json --noEmit：退出 0。
- ./node_modules/.bin/vitest run：13 文件 / **172 测试**通过。
- 其中 55 项跟随解析测试、32 项结构化后端 fixture 测试、16 项新客户端 helper/异步响应保护测试、10 项真实 DSH 服务集成测试。
- 真实服务测试使用 Cordis、Storage+JSON Domain、Typert Registry/Gateway、真实 SessionController.resolveAgent、WebRuntime、ToolRuntime、ToolWeb 和 PTC SDK 分派。验证 CAS、双 Session、重启 reopen、同 step 冻结、多查询、取消、subagent 拒绝和 disposed 保留记录。
- 跟随新增集成测试：真实 request/header 在 agent/request 后提交；两个 Session 原生/PTC 并发及多查询；三协议各自 endpoint/model/凭据引用；旧 step 配置保持、新 step 更新；实际模型变化重解析；adapter 替换拒绝；缺引用/凭据撤销不 fallback；按协议 options；凭据等待取消无 HTTP。
- Agent 目录/投影、模型注册目录、settings reader、Credentials、网络和 code execution substrate 是 fixture；PTC 调用走真实 SDK/scheduler，但不是实际 worker-thread 编译执行。
- 客户端 bundle 通过 DSH module-loader 形状测试；不是浏览器挂载验证。
- 构建：node scripts/clean.mjs、tsc -p tsconfig.build.json、tsdown --config tsdown.config.ts 均通过；生成 host/client bundle 与声明。
- node scripts/verify-package.mjs：通过，临时打包契约校验后删除 tgz，未发布。
- 本次构建后再次运行全部 **172 测试**通过；native Node 直接 import lib/index.js 通过。host/client bundle 和声明已重新生成，打包契约通过，未发布。
- git diff --check 通过。

pnpm 11.7.0 的现有 JS entrypoint 能安装/锁定依赖；使用现有 /tmp/pnpm/store，新增真实契约测试依赖并更新锁文件。offline 元数据曾过旧而失败，刷新后 frozen-lockfile 安装退出 0。pnpm run/check 仍可能触发启动器数据库错误；没有修改系统包管理器配置或把它报告成源码失败。verify-package 自带 npm pack 回退，不发布。

### 未验证

- 真实供应商认证、额度、模型实际搜索支持与跨网关行为；没有读取用户 Key 或擅自花费额度。
- 当前 Web GUI 的实际加载/布局、浏览器双窗口、HTTP/WebSocket carrier、冷 Session resume 权限边界。
- 完整真实 LLM loop 的重试/回退端到端；测试驱动实际 agent/request hook 的相同时序参数。
- 真实 worker-thread PTC substrate、进程 crash durability、历史 fork 重放、导出/导入迁移。

## 继续完成所需的宿主授权范围（尚未实施）

普通 API Key 跟随已在插件内实现，不需要宿主改造。以下是剩余目标或未来增强，需用户另行授权；不直接修改安装产物冒充稳定源码修复：

1. **可选通用绑定增强（不是首版前置）**：将来若要支持更多 adapter 与特殊认证，可在 dsh-llm / adapter / loop 中提供 adapter-owned 无密钥搜索描述和精确 generation；当前设置驱动的普通路由不等待此项。
2. **空白会话输入区**：dsh-client-ui-conversation 的 slots/composer/create-submit 边界。新增无 sessionId 也渲染的追加槽，创建 Session 后、首条 prompt 前提供通用可 await 草稿 handoff；写失败保留 draft/Session ID、停止发送并可幂等重试。不能覆盖 composer/model 单槽。
3. **真正删除/历史 fork 生命周期**：Session 持久层明确 durable-delete 通知及可验证的 fork 时刻；插件在确认耐久删除后清理自己的记录。不能复用 disposed。

应在明确的 DSH 源码分支实施并单独测试、构建宿主，再由用户决定何时恢复当前实例插件。此轮没有宿主授权，所以以上能力保持未接通状态。
