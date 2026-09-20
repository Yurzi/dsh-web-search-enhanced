# 交给下一个 Astra 的 V2 重构提示词

> 本文件可直接作为下一次 Astra 会话的任务提示词。先通读本文件及设计文档，再开始实现；不要只依据聊天摘要推测需求。

## 任务

请在当前仓库中执行 dsh-web-search-enhanced 的 V2 重构，而不只是再次给出设计建议。

工作区：`/mnt/data/yurzi/Workspaces/dsh/dsh-web-search-enhanced`。
设计基线：`docs/design-v2.converged.zh-CN.md`。
当前工作分支：`refactor/search-connections-v2`。
重构起点标记：`baseline/search-connections-v2`（应在接手时核实存在）。

你需要独立检查实际代码、依赖版本和宿主契约，将设计落实为实现、测试及文档。设计中的接口名、目录和时序方案有些是拟议的，不能把它们当成已经存在的 DSH API。若实现证据与设计矛盾，保留用户目标，先说明差异，再采用范围最小、可验证的方案。

## 1. Git 基线与既有改动

- 准备前 main / origin/main 所在提交：`744355f`，release v0.0.6。
- 已保存的既有源码检查点：`99f027c0004838c37cbf7f98eb1e18fcc1b58380`。
- 该检查点只保存准备前已存在的三处文件改动：`src/client/locales.ts`、`src/protocols.ts`、`tests/plugin.spec.ts`，内容是将默认 Anthropic 搜索标识与相关文案/断言调整为 `web_search_20260209`。
- 这不是上一位助手新实现的功能，也不代表已验证该标识适用于全部 Anthropic-compatible 后端。不要为了让旧测试通过而无解释地回滚，也不要机械替换所有旧标识 fixture。
- 设计文档和本提示词通过单独准备提交保存；用 `git log` 查看实际提交，不在文档中猜测自己的提交哈希。
- 接手先执行 `git status --short --branch`、`git log -4 --oneline` 和 `git show --stat baseline/search-connections-v2`。如有用户新增改动，先阅读并保留。
- 继续在当前重构分支工作。不要重建或强制移动已有分支/标记，不 reset/clean/stash 掉用户改动，不 amend 准备提交，不操作远端、不 push、不发布。

## 2. 不可丢失的用户需求

### 会话级组合与 UX

- 每个 Session 独立选择“对话模型 × 搜索连接”，两个平级选择器放在会话输入区。
- 会话级搜索选择是 P0，不得降级为只在设置页修改一个全局 activeProfile。
- 切换影响后续模型推理请求，已派生的搜索工具调用使用冻结上下文；不同 Session 并发不能串路由或凭据。
- 会话选择需要持久化、恢复、revision 冲突检查与明确的失效处理。不能只用浏览器 localStorage 或全局最后选择变量。

### 两种模型连接

1. **固定模型连接**：配置固定 model、protocol、endpoint、credentialRef，不受聊天模型切换影响。
2. **跟随会话模型**：内置连接，显示名为“跟随会话模型”；跟随发出此次工具调用的实际会话模型、协议、endpoint 与凭据绑定，不写回固定副本。

两者共用协议适配器；不是两套网络实现。协议兼容不等于支持真实搜索。当前路由不能安全解析或不支持搜索时，明确说明，不静默改用另一服务。

### 首批结构化后端

必须包含 **Firecrawl、Exa、Tavily、Tinyfish**，不是任选其中一个完成第一版。

- Firecrawl：Search API，首期 web 结果；实时性可使用其内联 scraping。
- Exa：Search API，内容新鲜度采用已核对的 maxAgeHours 契约，不把 deprecated livecrawl 作为新基础。
- Tavily：Search API，不默认额外生成答案。
- Tinyfish：专门的 Search API，不借 Agent/Browser 自动化模拟搜索，不凭空添加 limit 参数。

具体请求和响应务必以当前官方文档与 fixture 核验。官方链接在设计文档中，未进行过真实认证请求；不要把文档核对当作真实 API 测试通过。

### 配置与凭据

- 内置 Catalog 存放服务地址、默认参数、凭据引用和能力元数据，用户 settings 只存差异。
- 四个内置结构化连接只通过 DSH 契约配置对应 Key 即可使用：FIRECRAWL_API_KEY / EXA_API_KEY / TAVILY_API_KEY / TINYFISH_API_KEY。
- 不要求用户再写完整后端块或 enabled:true；也不因缺少其他后端的 Key 而阻止插件启动。
- 有 Key 只是连接可用，不代表自动选中或自动发请求。初始化不做网络健康探测。
- 凭据值只能走 DSH Credentials，按操作 resolve；不得写入 settings、日志、客户端描述、请求快照或测试 fixture。

### 顶层实时性

- 顶层 freshness 跨连接保持；不支持的后端直接忽略，不报错、不改写设置、不换服务。
- 设计建议 auto / fresh / realtime，语义是页面内容新鲜度及缓存控制，不是发布时间窗口或搜索深度。
- fresh 的 24 小时档位、Firecrawl 内联内容获取等属于设计选择，需明确额度/延迟影响并测试映射，不伪装为后端质量保证。
- Tavily time_range、Tinyfish recency_minutes 等时间过滤不能冒充绕过页面缓存；不支持等价控制时忽略。

### 保持架构减法

- 一个稳定的 enhanced-search Provider；继续使用原生 web_search({queries}) 和 WebSearchResult。
- Connection + Adapter 是核心；小型 Catalog、配置解析、会话状态和 DSH bridge 即可。
- 固定/跟随只在解析绑定处区分，主搜索流程不堆供应商分支。
- 不另建多查询聚合器、不做动态适配器平台、跨供应商自动兜底、多引擎融合或隐式模型总结。

## 3. DSH 接入注意事项

本机 `/usr/lib/deepseek-harness/` 目前观察到的是安装产物；先核实实际结构，不假设那里有完整可编辑源码。已核证据主要位于 `node_modules/@deepseek-ai/*/lib`，行号和来源见设计文档。

- 已有 Session 的 conversation.input.right 是列表槽，可与模型选择器并列；不要覆盖单占位的 conversation.input.model。
- settings 支持稀疏覆盖；Credentials 有现成 describe/resolve/set；Storage Domain 可保存插件自有 Session 状态。
- WebSearchProvider 只接收 query/maxResults 和 signal，不显式携带完整 Session/step 上下文。
- agent/request、tools/execute 是候选接线点。不要虚构 exec.search 字段或向 LlmCallConfig 塞未知 metadata；需测试私有上下文在原生工具及 PTC 中的隔离与传递。
- **最新设计是模型请求/step 级生效，不是整 turn 固定。** 早期研究中的 turn/start 冻结方案不要直接当作最终 UX 语义。
- 跟随连接应读取已提交的实际有效模型上下文，而不是浏览器待生效选择或中间 Hook 提议。验证重试、模型回退、队列以及请求头不变时的身份区分。
- 使用自有存储/诊断，不把所有协议记录为 DeepSeek 专用事件，也不随意新增宿主无法恢复的 Session Event。

### 明确的宿主缺口

当前无 sessionId 时，输入区 left/right/model 槽不渲染；创建请求无通用插件草稿选择载荷。完整“首条消息前选搜索连接”需要：

1. 可在空白会话显示的 session-maybe additive 槽。
2. 创建 Session 后、首条 prompt 前的 awaited draft handoff。

这些是待新增契约，不是现有能力。不能用 DOM 劫持或覆盖 composer 假装完成。

**当前授权范围是本工作区。** 若必须修改外部 DSH 宿主，先说明精确改动及目标，按实时 sandbox/审批规则请求授权；不要直接修改系统安装物。可先完成插件侧接口与测试，给出独立宿主补丁方案，并明确该 UX 尚未完成，不能把未接通路径标为全量完成。

## 4. 准备时的验证基线

| 检查 | 准备时结果 |
| --- | --- |
| Node | v26.9.0 |
| pnpm run typecheck / pnpm run test | 均在 pnpm 启动阶段退出 1：unable to open database file；没有进入检查器，不代表源码检查失败 |
| ./node_modules/.bin/tsc -p tsconfig.json --noEmit | 通过，退出 0 |
| ./node_modules/.bin/vitest run | 通过，7 个测试文件、48 个测试，退出 0；实际 Vitest v4.1.11 |
| git diff --check | 准备前检查通过 |
| build / verify:package / 完整 pnpm run check | 本次未执行；不能据此声称已重新构建发布产物 |
| 真实供应商 API / GUI / 宿主新接口 | 未验证 |

pnpm 数据库错误的根因未定位，本次没有修改包管理器配置、升级依赖、重装依赖或尝试写入系统环境。上面的本地可执行文件对应 package.json 中的检查器；这是避开启动器故障的等价检查，不是绕过 sandbox 拒绝。若下一会话仍复现，先诊断环境并遵守工具审批规则，不反复尝试越权路径。

这些是重构之前的状态，不要将已有失败报告成你引入的回归，也不能因为已有失败就跳过最终验证。

## 5. 建议执行顺序

1. 阅读设计全文、package.json、src、tests 和实际适用指令；检查当前依赖与宿主 API。
2. 建立任务清单，优先验证高风险 DSH 接线与请求时序；不要先写一整套依赖虚构接口的 UI。
3. 建立 Catalog、稀疏配置 schema、连接解析、会话状态契约和测试。
4. 完成四个结构化适配器、三种模型协议和固定/跟随绑定，使用脱敏 fixture 和 mock transport。
5. 接入 Provider、凭据与请求上下文，验证多 Session、同 step 多查询、取消和重试。
6. 实现输入区选择器、Key-only 管理、顶层 freshness、冲突与失效状态。
7. 处理旧配置迁移、会话恢复/fork/清理、文档和包发布契约；宿主扩展单独处理授权。
8. 按逻辑阶段验证并提交到当前分支，不创建一个难以审查的大提交；不 push、不改发布版本，除非用户另外要求。

允许按实际证据调整模块拆分和顺序，但不要删减上述用户需求。事实已能本地查明时自行核实，不向用户反复询问；只有影响范围、安全、费用或需求含义的决策才提问。

## 6. 最终验证与交付

- 配置：Key-only 不写全量目录；稀疏覆盖、reset、失效凭据与自定义实例正确。
- 模型：固定不随聊天改变；跟随完整绑定；不支持路由明确失败；待生效模型不污染旧工具。
- 会话：并发隔离、请求快照、revision、多窗口、恢复、首条消息 handoff。
- 四个后端：请求/认证/解析、空结果、限流、错误、取消、数量上限、真实支持的 freshness 映射。
- 安全：无秘密回显和日志泄漏；GET 查询脱敏；无隐式跨服务兜底。
- 回归：类型检查、单元测试、构建、verify:package，按 package.json 的实际脚本执行。
- 真实供应商调用需要用户配置测试 Key 并授权额度；不能擅自使用发现的凭据。
- GUI 是否生效须按实际构建/加载机制验证；不能只改代码就宣称已更新运行中的页面，不启动替代服务器冒充现有 GUI。

交付说明列出：已完成的需求、具体提交、测试命令与结果、已有失败/新增回归、未验证项、宿主缺口和授权阻塞。若没有完整闭环，不要只说“重构完成”。
