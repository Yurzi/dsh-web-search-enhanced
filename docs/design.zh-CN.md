# dsh-web-search-enhanced 需求分析与架构设计

## 1. 需求评估

DSH 的模型侧 <code>web_search</code> 并不直接绑定某个 HTTP 协议。调用链是 <code>dsh-tool-web → ctx.web.search() → WebSearchProvider</code>，因此正确扩展点不是覆盖工具注册表，也不是修改 agent loop，而是注册新的 <code>ctx.web</code> search provider，并在 WebRuntime 配置中选择该 provider。这样可保持模型工具名称、参数、权限、超时与结果渲染不变。

本插件必须支持三种协议切换、上游内置搜索标识符和最大输出 Token 配置、Web Profile 可视化编辑，以及统一的 <code>WebSearchResult</code>。为使协议可实际调用，还必须配置 <code>baseURL</code>、<code>model</code> 和 <code>apiKeyEnv</code>。<code>maxUses</code>、<code>apiVersion</code> 与 <code>searchContextSize</code> 是协议适配需要的窄扩展字段。

插件在 <code>current-session</code> 模式下读取当前 Agent 的模型选择与 <code>llm-pi-ai</code> 路由配置，跟随模型、Provider、调用协议、接口地址和凭据；无法解析时使用固定配置及 <code>fallbackModel</code>。非目标包括重新注册模型侧工具、通用函数工具执行、浏览器写入 settings document 明文 API Key，以及修改 deepseek-harness 源码。

## 2. 组件与数据流

~~~mermaid
flowchart LR
  M[Agent model] --> T[dsh-tool-web / web_search]
  T --> W[ctx.web]
  W --> P[EnhancedSearchProvider]
  S[Web Profile settings] --> P
  P --> A[Protocol request adapter]
  A --> H[Credentialed HTTPS request]
  H --> R[Protocol response parser]
  R --> N[WebSearchResult]
  N --> T
~~~

Host 入口通过 <code>ctx.inject(['settings'], ...)</code> 注入并调用 <code>settingsCtx.settings.installSection()</code> 注册 <code>web-search-enhanced</code> namespace。每次搜索开始时只读取一次 resolved settings，保证一次调用不会混用更新前后的 endpoint、协议和 Token 上限。provider ID 在注册时固定；实时设置不能修改该字段，否则 <code>ctx.web</code> 的 provider 选择会与已注册对象不一致。

Client 入口把相同 namespace 绑定到 <code>settings.plugin.item</code> keyed slot。插件配置页只在 Host 暴露 namespace 时渲染卡片，未加载 Host 插件时不会出现不可用配置项。

## 3. 协议映射

| 协议 | Endpoint | 搜索标识符位置 | Token 字段 | 响应来源 |
| --- | --- | --- | --- | --- |
| Anthropic Messages v1 | <code>/messages</code> | <code>tools[0].type</code>，默认 <code>web_search_20250305</code> | <code>max_tokens</code> | <code>web_search_tool_result</code> + text citations |
| OpenAI Responses | <code>/responses</code> | <code>tools[0].type</code> 与 <code>tool_choice.type</code>，默认 <code>web_search</code> | <code>max_output_tokens</code> | <code>web_search_call</code>、sources、message annotations |
| OpenAI Chat Completions | <code>/chat/completions</code> | 官方模式固定 <code>web_search_options</code>；vendor 模式可配置字段名 | <code>max_tokens</code> | assistant message annotations 与顶层 citations |

Chat Completions 与 Responses 的联网搜索表示不同。官方 Chat Completions 仅支持专用搜索模型，并通过固定 <code>web_search_options</code> 启用搜索，不接收 Responses 的 built-in <code>tools[]</code>。默认 <code>chatSearchMode=search-model</code> 固定使用该官方字段；只有网关明确声明自定义顶层选项字段时才选择 <code>vendor-options</code>，此时 <code>toolIdentifier</code> 才控制字段名。

所有请求设置 <code>stream: false</code>。Responses 强制 <code>tool_choice</code> 为配置的 built-in 类型；Anthropic 通过 <code>max_uses</code> 约束服务端搜索次数；Chat 由专用搜索模型与搜索选项字段决定搜索执行；普通 Chat 模型不构成可用的 web search capability。

## 4. 配置模型

Schema defaults → Profile composition base → 用户持久化覆盖构成设置层级。resolved config 在操作入口校验 provider ID、绝对 URL、必填字符串、安全标识符、正整数 Token/使用次数和封闭 context-size 枚举。配置卡片采用暂存编辑；客户端即时校验，Host 执行权威校验。恢复 Profile 清除用户层字段，不复制默认值。

## 5. 错误与安全

| code | 条件 |
| --- | --- |
| <code>WEB_PROVIDER_CREDENTIAL_MISSING</code> | literal key、<code>ctx.credentials</code> 与 launch environment 均不可用 |
| <code>WEB_ABORTED</code> | 调用前、请求中或读取响应时取消 |
| <code>WEB_PROVIDER_ERROR</code> | 网络、HTTP、JSON、协议结果或服务端搜索失败 |

所有凭据请求设置 <code>redirect: error</code>，在跟随重定向前失败，避免 Authorization 或 <code>x-api-key</code> 自动转发到其他 origin。Anthropic 同时发送 <code>x-api-key</code> 与 Bearer 以兼容 DeepSeek 和 Anthropic-compatible gateway；OpenAI 协议仅发送 Bearer。错误消息不包含密钥。<code>baseURL</code> 禁止 userinfo、query 和 fragment，避免 URL 本身携带凭据。

Parser 不从自然语言伪造来源。Anthropic 或 Responses 没有服务端搜索执行标记时直接失败；Chat Completions 公开响应没有独立 search-call item，因此以 assistant message 为最小成功条件，并从 annotations/citations 提取来源。

## 6. UX 设计

卡片复用 DSH 设置页语义：12px 卡片圆角、14×16px header、<code>--dsw-alias-*</code> token、折叠箭头、未保存徽标、34px 表单控件、帮助文本，以及保存/放弃/恢复 Profile footer。界面提供中英文 typed dictionary、可访问 label、<code>aria-expanded</code>、<code>aria-invalid</code> 与错误状态。

协议切换会改变高级字段：Anthropic 显示 <code>maxUses</code> 与 <code>apiVersion</code>；OpenAI 显示 <code>searchContextSize</code>。<code>toolIdentifier</code> 帮助文案随协议说明准确 wire 位置。

## 7. 测试策略

- 协议单元测试固定 endpoint、搜索标识符位置与 Token 字段；
- parser 测试覆盖引用合并、去重与缺少 search-call 失败；
- provider 测试覆盖重定向策略、取消、缺少凭据、HTTP 错误与成功归一化；
- settings 测试覆盖默认值、非法字段与动态协议更新；
- Client helper 测试覆盖 draft、输入校验、凭据引用默认值与双语字典；
- 跟随模式测试覆盖当前模型、三种协议、路由凭据、fallbackModel 与预算字段；
- 发布验证检查 Host ESM、Client bundle、类型声明、协议子路径与 Cordis patch。

## 8. 已知风险与后续工作

1. DSH 当前没有外部插件可注册的持久化 SessionEvent catalog。参考插件 <code>dsh-web-search-responses</code> 也不记录其辅助 Responses 请求。本插件不会伪造现有 DeepSeek 专用事件，也不会写出 Host 无法恢复的未知事件；因此实际 endpoint、model 与完整协议 body 不可由 session log 重建。严格执行辅助模型请求可重放的部署不能使用本 standalone 插件。
2. OpenAI-compatible 网关可能只实现部分官方字段。Adapter 保持严格，不做静默 fallback。
3. Responses 的完整 <code>action.sources</code> 可能要求提供方支持显式 include；message annotations 仍可提供引用。应在确认目标网关后再增加兼容开关。
4. API Key 设置 UI 通过 <code>ctx.remote.credentials.set()</code> 写入 Harness credentials；输入框只持有待写入值，成功后清空，普通 settings document 不保存密钥。
