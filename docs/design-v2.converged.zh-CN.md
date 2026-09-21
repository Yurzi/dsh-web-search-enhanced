# 0.1.1 当前架构与实现边界

本文描述已存在的源码契约，不是未来设计提案或历史验收记录。为避免外部链接失效，保留原文件名。用户配置见[配置参考](configuration.zh-CN.md)，验证方法见[开发验证指南](v2-implementation.zh-CN.md)。

## 1. 总体职责

插件为 DSH 原生 `web_search` 注册 `enhanced-search` provider。模型工具签名、结果结构和宿主访问控制不变；原生调用与 PTC 调用经过同一工具执行链。它不是第二套模型工具，不接管 `web_fetch`，不替换对话模型。

```text
Settings + 内置 Catalog ── resolveSettings ───────────────┐
DSH Storage Domain ── SessionSelections ────────────────┤
实际 agent/request ── 按 agent + turn + step 捕获快照 ──┤
                                                       ↓
tools/execute 的 exec.agent → 私有 AsyncLocalStorage → enhanced-search
                                                       ↓
                         当前选中的 structured / fixed model / session model
                                                       ↓
                         必要时解析 DSH Credential → 单一路径网络请求
                                                       ↓
                                 原生 WebSearchResult + 私有实时性诊断
```

安装补丁 [cordis.patch.yml](../cordis.patch.yml) 指定 `web.searchProvider: enhanced-search`、禁用默认 `web-search-deepseek`，并为新会话明确指定 Exa。补丁不指定 `fetchProvider`，保留宿主原有 fetch 选择逻辑。

## 2. 模块边界

| 模块 | 职责 |
| --- | --- |
| [src/index.ts](../src/index.ts) | 插件 schema、Settings 注册、显式迁移门禁、安装 bridge |
| [src/catalog.ts](../src/catalog.ts) | 无秘密的稳定内置 ID、地址、默认引用和能力 |
| [src/config.ts](../src/config.ts) | 稀疏合并、字段白名单、URL / 引用 / options 校验 |
| [src/migration.ts](../src/migration.ts) | 纯旧配置转换，不读 Key、不写 Settings、不执行 fallback |
| [src/dsh/bridge.ts](../src/dsh/bridge.ts) | 服务生命周期、授权 Remote、请求钩子与 provider 注册 |
| [src/dsh/session-selection.ts](../src/dsh/session-selection.ts) | 会话选择持久化、初始化、revision CAS |
| [src/dsh/execution-context.ts](../src/dsh/execution-context.ts) | WeakMap 快照、递归冻结、AsyncLocalStorage 执行上下文 |
| [src/dsh/session-model.ts](../src/dsh/session-model.ts) | 跟随模型的非秘密配置捕获、实际模型选择和绑定解析 |
| [src/search/service.ts](../src/search/service.ts) | 单一路由分派、执行时凭据解析、错误归类 |
| [src/adapters/structured.ts](../src/adapters/structured.ts) | 四种 REST 适配、受限 options、共享有界 JSON 传输 |
| [src/adapters/mcp.ts](../src/adapters/mcp.ts) | 私有 keyless MCP 传输与结果解析 |
| [src/protocols.ts](../src/protocols.ts) | 三种模型协议的请求构造和响应归一化 |
| [src/remote-contract.ts](../src/remote-contract.ts) | 严格 Remote 请求 / 响应 schema 与调用描述符 |
| [src/client/V2Settings.tsx](../src/client/V2Settings.tsx) | 当前连接设置界面、稀疏操作和显式导入 |
| [src/client/SearchConnectionSelector.tsx](../src/client/SearchConnectionSelector.tsx) | 当前会话连接与实时性选择器 |

`model-config.ts`、`provider.ts` 的 `createProvider` / `EnhancedSearchProvider` 是兼容固定配置辅助接口；安装版始终走 V2 bridge。旧辅助代码中的环境变量或 fallback 行为不能外推为安装版配置能力。

## 3. 配置和秘密分离

当前设置格式为 version 2，包版本为 0.1.1。内置目录只做默认值；用户保存差异，不把目录整表复制到用户层。四种结构化内置连接默认 keyless，访问方式为显式选择，不根据已保存 Key 猜测。自定义连接只允许支持的 adapter 或固定模型协议；新 endpoint 需要信任确认。

内置结构化连接不能重定向地址或改变 adapter。自定义结构化连接只能使用个人 Key；固定模型总是需要显式信任。校验拒绝任意 headers/body、缓存参数、秘密字段等不受支持的 options。禁用连接也参与配置校验。

快照只保存凭据引用，不保存 Key。执行时通过 DSH Credentials 解析指定引用；keyless 完全跳过解析。UI 调用 Credentials describe 检查本地配置状态，不用供应商网络探测。保存、重置 Settings 与删除凭据是不同操作。

## 4. 会话状态与并发

Storage Domain 名称为 `web_search_enhanced`，版本 1，表为 `selections`；用完整 Session ID 作键，记录 `{ connectionId, freshness?, revision }`。不退化为 localStorage 或仅内存状态。

初始化顺序：

1. 已有记录优先，保留失效连接 ID 和 `null`。
2. seeded fork 首次初始化时复制父会话当前值；此后独立，不重建历史 fork 边界。
3. 无记录时（首次初始化）：
   a. 优先读取模型配对状态缓存（位于 `$DSH_HOME/cache/web-search-enhanced/model-connections.json`），若存在当前会话模型上一次选择的配对连接（包括明确关闭搜索的 `null`）且连接有效（存在且未禁用），则默认使用该配对连接。
   b. 若无匹配缓存（新模型或连接已失效），使用配置文件里的显式 `defaultConnection`。
   c. 没有显式默认时，仅有一个本地可用连接才选中，否则为 `null`。

旧记录缺少 freshness 时，首次读取以当前全局默认原子补入，保留连接和 revision；以后不再跟随默认变化。两项偏好共用一个 revision，set 可单独更新连接、单独更新实时性或同时更新，至少含一项。基于 storage update 的 CAS 拒绝过期 revision，本地串行队列避免重复初始化。

Remote `searchConnections.get/set` 先通过真实 Session Controller 解析并授权 agent；严格 schema 拒绝未知字段。会话 ID 只存在于授权 Remote，不加入模型可控工具参数或公共 WebSearchContext。

Domain 在 Cordis 注入作用域懒打开，首次打开 single-flight；失败清除缓存以便重试，退出作用域时等待关闭。`agent/disposed` 清理内存快照；`session/disposed` 不代表耐久删除，不能据此删存储。缺乏可靠删除通知时允许保留孤立记录。

## 5. 请求冻结与恢复

`agent/request` waterfall 捕获当前选择、解析后连接及实时性。成功快照按 agent 身份 + turn + step 固定，同一步重入不会因用户改设置而改变路由。`tools/execute` 从可信 `exec.agent` 找快照，通过 AsyncLocalStorage 传给 provider，避免并发会话共享全局“当前 Session”。

配置、迁移或存储故障被转换成安全失败快照，仍调用 next() 允许普通推理。存储暂不可用是可恢复类别：后续请求钩子可在同一步重新捕获；已成功快照不替换。工具执行中不临时重读设置“修补”失败快照。未知上下文拒绝搜索，不猜测 Session。

连接、访问方式、实时性、模型路由配置中途修改只影响后续请求快照；Key 值并未冻结，执行时撤销 / 缺失可以阻止网络请求。

## 6. 分派与传输

| 选中模式 | 生产路由 |
| --- | --- |
| Exa keyless | 官方 MCP，initialize → notifications/initialized → tools/call (`web_search_exa`) |
| Tinyfish keyless | 官方 MCP，直接单次 tools/call (`search`)，带访问模式头，不初始化 |
| Firecrawl keyless | 官方 `/v2/search` REST，不发送 Authorization |
| Tavily keyless | 官方 `/search` REST，只用 keyless 访问模式头 |
| 四种服务个人 Key | 各自 REST；Exa/Tinyfish 使用 X-API-Key，Firecrawl/Tavily 使用 Bearer |
| 固定 / 跟随模型 | Anthropic Messages、OpenAI Responses 或 Chat Completions |

没有跨服务 fallback、匿名与付费互转、自动重试或自动翻页。Firecrawl MCP 格式解析是适配器内部受测能力，不是正式 Firecrawl 路由或 REST 失败后的备用通道。

REST 共享 fetchJson，MCP 使用私有 Streamable HTTP 客户端；均有 90 秒操作期限、2 MiB 响应上限、取消支持和拒绝重定向。即使注入 transport 忽略 signal，也终止等待并释放晚到响应。MCP 支持 JSON / SSE、多行 data、分块 UTF-8、JSON-RPC ID 精确匹配，拿到匹配结果即取消流，不等待无终点 SSE EOF；不共享跨会话 MCP 会话缓存。

传输 / parser 失败不泄漏原始响应、输入或 cause。来源归一化规则按适配器实现，不应假定所有协议都具备相同去重或日期语义。结构化 REST 限制 URL 协议与内嵌认证，限制标题 / 片段长度；MCP 另过滤控制字符与重复来源。未知结果结构不能伪装为成功空结果。

## 7. 跟随模型

跟随模式并非自动复用宿主所有认证机制。优先读取实际 agent 请求头的完整 provider/model；仅请求头不存在才读同一 agent options，不补拼不完整路由。

每个请求捕获 `llm-pi-ai.providers` 中的非秘密 api/baseURL/apiKeyEnv 及只读目录；只有协议 / 地址缺省才从经过形状检查的 adapter 目录补齐。显式配置不依赖该可选兼容入口。FollowRequest 按 provider/model 缓存解析结果，执行时核对 adapter 身份，替换后拒绝旧请求。实际模型选择在工具执行时解析，而 provider 设置保持请求时快照；不能把它简化成全局固定模型。

不重建 scoped credential records，不读取 OAuth / 订阅秘密，不透传自定义 headers，不虚构 rc.2 不支持的 model 级 endpoint/API/凭据覆盖。协议受支持也不代表模型有服务端搜索能力。

## 8. 实时性和诊断

Firecrawl 的 fresh/realtime 映射为内联 scrapeOptions.maxAge（86400000 / 0 毫秒），Exa REST 为 contents.maxAgeHours（24 / 0 小时）。其他路径不发送猜测参数。Firecrawl 请求正文失败或缺失时不把 SERP 摘要当新正文。

`src/search/diagnostics.ts` 只记录请求偏好、default/applied/ignored/partial、来源及正文数量，`freshnessVerified` 恒为 false。bridge 内存中最多保留 100 条，并附会话 ID、连接 ID 和 step；不保存查询、Key 或上游原始正文，不扩展宿主结果 / Session 事件，不是公共 Remote。

## 9. 客户端与非目标

设置使用官方 `settings.plugin.item` 槽和 SettingsScope 路径操作；凭据使用宿主 Remote。会话选择器通过 `conversation.input.right` 追加槽，Remote 挂载后在独立注入作用域注册，不替换 composer / 模型槽，不抓取 DOM。

选择器只列本地可用连接并隐藏空组，但保留不可用的当前选择以供显式修复；使用原生 popover、键盘导航、Esc 与焦点恢复。主题使用宿主 `--dsw-alias-*` 令牌。空白会话首消息前没有独立选择器，靠默认连接初始化。

本版本不修改 DSH 宿主、不新增任意 HTTP 路由、不维护用户自建密钥文件、不绕过上游限制、不保证匿名服务随时可用。隔离渲染和测试 harness 不等于运行中 GUI 已重新安装；发布 / 部署验证须另行执行并如实记录。
