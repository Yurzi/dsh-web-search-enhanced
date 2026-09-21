# 0.1.0 配置参考

本指南面向安装版插件。包版本为 **0.1.0**，配置格式的 `version` 为 **2**；两者不是同一版本号。快速开始见 [README](../README.md)，旧版用户先读[升级指南](migration.zh-CN.md)。

## 配置入口与作用范围

在 DSH 设置的 Web Search Enhanced 卡片管理搜索连接、凭据引用与新会话默认值，在已有会话输入区选择搜索连接和内容实时性。搜索连接独立于对话模型。设置按宿主 SettingsScope 保存稀疏覆盖，不复制整个内置目录；恢复继承设置、删除用户连接覆盖均不删除 Credentials。继承层中的连接在移除用户覆盖后仍可能存在。

以下 YAML 的 `web-search-enhanced` 是 Settings 命名空间。若编辑 Cordis 插件条目的 `config`，仅放该命名空间下的字段，不能原样把整个示例作为 Cordis 根配置。优先使用设置 UI，避免覆盖其他插件设置。

```yaml
web-search-enhanced:
  version: 2
  defaultConnection: builtin:exa
  freshness: auto
```

| 顶层字段 | 类型 / 默认 | 含义 |
| --- | --- | --- |
| `version` | `2`；纯新配置可省略 | 显式标记当前配置格式；旧路由必须导入，不能只改版本绕过迁移 |
| `defaultConnection` | 非空连接 ID；解析器不设默认 | 仅初始化没有持久选择的会话。安装补丁显式设为 `builtin:exa` |
| `freshness` | `auto` / `fresh` / `realtime`；`auto` | 新会话默认实时性；旧记录缺少此字段时首次读取补入一次 |
| `connections` | ID → 配置对象；空覆盖 | 内置连接的差异或完整自定义连接 |

未设默认连接时，只有恰好一个本地可用连接才自动选中，否则保持未选择。不要依赖目录顺序。显式默认 ID 不会自动修复为其他连接；请确保它存在、未禁用且凭据可用。已有会话保存的连接（包括未选择）不随默认改变。

## 内置供应商与访问方式

四种结构化服务默认 `access: keyless`。保存个人 Key **不会**自动切换模式；必须显式改为 `api-key`。失败、限流、匿名访问拒绝均不会自动改用个人 Key、其他服务或其他协议。

| ID | 免 Key 路径 | 个人 Key 路径 / 默认凭据引用 |
| --- | --- | --- |
| `builtin:exa` | `https://mcp.exa.ai/mcp`，工具 `web_search_exa` | `https://api.exa.ai/search`；`EXA_API_KEY` |
| `builtin:firecrawl` | `https://api.firecrawl.dev/v2/search`，不发 Authorization | 同址 REST；`FIRECRAWL_API_KEY` |
| `builtin:tavily` | `https://api.tavily.com/search`，`X-Tavily-Access-Mode: keyless` | 同址 REST；`TAVILY_API_KEY` |
| `builtin:tinyfish` | `https://agent.tinyfish.ai/mcp`，`search`，`X-TinyFish-Access-Mode: keyless` | `https://api.search.tinyfish.ai`，GET；`TINYFISH_API_KEY` |
| `builtin:session-model` | 不支持匿名；跟随当前实际 agent 模型 | `llm-pi-ai` 对应 provider 的显式 `apiKeyEnv` |

免 Key 是上游公共访问能力，不是无限额度、服务可用性或永久免登录承诺。IP、地区、额度、服务策略均可能导致拒绝。设置页显示“已配置 / 免 Key”仅说明本地条件满足，不会发网络请求测试供应商。

内置结构化连接只允许覆盖 `label`（非空）、`disabled`（布尔，默认 false）、`credentialRef`、`access`、`options`。不能改其 `kind`、`adapter`、`endpoint` 或添加任意请求字段。

```yaml
web-search-enhanced:
  version: 2
  connections:
    builtin:exa:
      access: api-key
      credentialRef: EXA_API_KEY
      options:
        type: fast
    builtin:firecrawl:
      disabled: true
```

### 结构化 options 白名单

| adapter | 字段 | 接受值 |
| --- | --- | --- |
| Firecrawl | `country` | 两个英文字母 |
| Firecrawl | `location` | 1–200 字符，不含 U+0000–U+001F |
| Firecrawl | `safe` | 布尔 |
| Exa | `type` | `auto`、`fast`、`instant`；仅个人 Key |
| Tavily | `search_depth` | `basic`、`advanced`、`fast`、`ultra-fast` |
| Tavily | `topic` | `general`、`news`、`finance` |
| Tinyfish | `location` | 两个英文字母 |
| Tinyfish | `language` | 2–3 个英文字母，可带连字符及 2–4 个字母后缀 |
| Tinyfish | `purpose` | 1–2000 字符，不含 U+0000–U+001F |
| Tinyfish | `domain_type` | `web`、`news`；个人 Key 另可用 `research_paper` |

Exa 免 Key 仅接收查询与数量，非空 options 会被拒绝。Tinyfish 免 Key 查询上限 2000 字符，不能使用 `research_paper`。Firecrawl 查询上限 500 字符，其他结构化 REST 查询上限 10000 字符。数量由工具请求和适配器控制，不能在 options 设置 `limit`、`numResults`、分页或缓存字段。Tavily 请求数量上限 20，Firecrawl/Exa REST 上限 100；Tinyfish 使用单页结果，本地按请求数量裁剪。不自动重试或翻页。

## 内容实时性

实时性指**内容缓存 / 抓取偏好**，不是发布日期过滤，也不证明页面内容确实最新。它在当前会话持久保存，切换连接保留，fork 复制父会话当前值后独立。连接和实时性共用 revision，多标签页冲突需刷新后重试。请求开始后修改设置不改变该请求已冻结的路由与偏好。

| 模式 | Firecrawl（两种访问方式） | Exa 个人 Key | Exa 免 Key、Tavily、Tinyfish、模型 |
| --- | --- | --- | --- |
| `auto` 自动 | 默认搜索策略 | 默认内容策略 | 默认行为 |
| `fresh` 优先新鲜 | `scrapeOptions.maxAge=86400000` 毫秒 | `contents.maxAgeHours=24` 小时 | 忽略该偏好，不猜测上游参数 |
| `realtime` 优先实时 | `scrapeOptions.maxAge=0` | `contents.maxAgeHours=0` | 同上 |

Firecrawl 非 auto 会请求内联 Markdown 正文，正文缺失时不拿旧搜索摘要冒充新抓取内容。内联抓取可能增加延迟和额度消耗。内部诊断使用 default/applied/ignored/partial，但 `freshnessVerified` 始终为 false；诊断不是结果新鲜度认证或公开 UI 接口。

## 凭据

个人 Key 由 **DSH Credentials** 保存和解析。设置只写引用名称；引用须匹配 `[A-Za-z_][A-Za-z0-9_]*`。不要把 Key 写进 YAML、options、URL 或日志。匿名路径不解析个人凭据，也不发送个人认证头。Key 的撤销在实际执行时生效，因为请求快照冻结引用而非秘密值。

在设置中选择或填写引用并保存 Key；只读凭据由其宿主配置来源管理。空输入不是删除凭据命令。引用名称正确、已配置仍不保证供应商授权或额度有效。无独立密钥文件管理、订阅登录抓取或隐式认证猜测。

## 自定义结构化连接

ID 格式为 `custom:` 加 1–100 个字符，首字符为字母或数字，后续可含字母、数字、点、下划线、连字符。必需 `label`、`kind: structured`、已支持的 `adapter`、`credentialRef`；可用 `disabled`、`endpoint`、`trustedEndpoint`、`options`。省略 endpoint 使用该 adapter 的官方 REST 地址；不同地址必须显式 `trustedEndpoint: true`。自定义结构化连接**只用个人 Key**，不接受 `access`、任意 headers 或任意 body。

```yaml
web-search-enhanced:
  version: 2
  connections:
    custom:team-tavily:
      label: 团队 Tavily
      kind: structured
      adapter: tavily
      credentialRef: TEAM_TAVILY_API_KEY
      options:
        topic: news
```

自定义地址必须为绝对 HTTP(S) URL，不含内嵌账号密码、查询或片段。信任标志意味着你同意向该地址发送搜索词与所选凭据，不是自动安全检测；建议使用 HTTPS。

## 固定搜索模型

自定义模型必须为 `kind: model`，含 `label`、`trustedEndpoint: true` 和完整 `binding`。`disabled` 默认 false，`options` 默认空对象。

```yaml
web-search-enhanced:
  version: 2
  connections:
    custom:search-model:
      label: 专用搜索模型
      kind: model
      trustedEndpoint: true
      binding:
        mode: fixed
        protocol: openai-responses
        model: YOUR_SEARCH_CAPABLE_MODEL
        baseURL: https://api.openai.com/v1
        credentialRef: SEARCH_MODEL_API_KEY
      options:
        maxTokens: 4096
        searchContextSize: medium
```

`model` 必须非空；示例占位值需替换为实际支持服务端搜索的模型。`baseURL` 遵守上述 URL 约束。支持协议和路径：

| protocol | 请求路径 | 默认 toolIdentifier |
| --- | --- | --- |
| `anthropic-messages` | 规范化为 `/v1/messages` | `web_search_20260209` |
| `openai-responses` | 追加 `/responses` | `web_search` |
| `openai-chat-completions` | 追加 `/chat/completions` | `web_search_options` |

已有对应完整后缀不会重复追加；OpenAI 基地址需要的 `/v1` 由用户提供。协议兼容不等于该模型 / 代理实现了搜索工具。

| 模型 options | 默认 / 验证 | 生效范围 |
| --- | --- | --- |
| `apiVersion` | `2023-06-01`，非空字符串 | Anthropic 版本头 |
| `toolIdentifier` | 见上表；字母开头，后接字母、数字、`_ . : -`，总长不超过 128 | Anthropic 工具类型、Responses 工具类型、Chat vendor 字段 |
| `maxTokens` | 4096，正整数 | 三种协议输出预算 |
| `maxUses` | 5，正整数 | Anthropic `max_uses` |
| `chatSearchMode` | `search-model` 或 `vendor-options`；前者默认 | Chat 前者固定发 `web_search_options`，后者以 toolIdentifier 为字段名 |
| `searchContextSize` | 未设置；可选 `low` / `medium` / `high` | Responses / Chat 搜索上下文 |

这些是白名单而非任意参数透传。模型路径可能返回回答文本及引用；结构化路径只返回来源，不生成额外摘要。

## 跟随会话模型

`builtin:session-model` 仅允许 `disabled` 和 `optionsByProtocol` 覆盖，不能重命名或设置固定 binding。每个协议单独保存上述模型 options：

```yaml
web-search-enhanced:
  version: 2
  defaultConnection: builtin:session-model
  connections:
    builtin:session-model:
      optionsByProtocol:
        anthropic-messages:
          maxUses: 3
        openai-responses:
          searchContextSize: low
```

实际 agent 请求头必须有完整 provider/model；仅无请求头时才读同一 agent options，不混拼不完整字段。插件读取 `llm-pi-ai.providers[provider]` 的 `api`、`baseURL`、`apiKeyEnv`；协议也识别宿主的 `openai-completions` 为 Chat Completions。只在缺省协议 / 地址时尝试只读模型目录补齐。

必须有显式 `apiKeyEnv` 并能通过 Credentials 解析。当前不支持 OAuth、订阅认证、内联 apiKey/auth、非空自定义 headers，或 model 级路由覆盖。宿主能对话不代表此连接可搜索；不支持时改选结构化服务或显式固定模型，不会自动 fallback。

## 故障与恢复

| 错误 / 现象 | 处理 |
| --- | --- |
| `WEB_SEARCH_NOT_SELECTED` | 在当前会话显式选择连接，或设置新会话默认后创建新会话 |
| `WEB_SEARCH_CONNECTION_INVALID` | 已保存连接被删除 / 禁用；恢复它或重新选择，插件不会偷换 |
| `WEB_PROVIDER_CREDENTIAL_MISSING` | 检查当前模式、引用和 DSH Credentials；保存 Key 后仍须显式选个人 Key 模式 |
| `WEB_KEYLESS_UNAVAILABLE` | 当前网络被上游拒绝匿名访问；等待或手动选个人 Key / 其他连接，不绕过上游限制 |
| `WEB_PROVIDER_AUTH_ERROR` | 个人凭据鉴权失败，检查 Key 与 endpoint 的归属 |
| `WEB_PROVIDER_ACCESS_ERROR` | 上游访问 / 计费限制（如 HTTP 402），检查账户 |
| `WEB_PROVIDER_RATE_LIMITED` | HTTP 429 等限流；等待并检查额度，不自动重试或转付费 |
| `WEB_SEARCH_FOLLOW_UNSUPPORTED` | 检查 provider 协议、地址、显式 apiKeyEnv、模型能力；必要时用固定连接 |
| `WEB_SEARCH_MIGRATION_REQUIRED` | 按升级指南显式导入旧配置 |
| `WEB_SEARCH_CONFIG_INVALID` | 检查未知字段、options、信任确认及引用格式；禁用连接也必须配置合法 |
| `WEB_SEARCH_STORAGE_UNAVAILABLE` | 检查 DSH storage-domain 及持久后端；恢复后下一请求会重试 |
| `WEB_SEARCH_CONTEXT_UNAVAILABLE` | 缺少真实请求执行上下文；发起新的模型请求，不在工具参数伪造 Session |
| `WEB_PROVIDER_TIMEOUT` / `WEB_ABORTED` | 检查网络或取消状态；网络操作期限为 90 秒 |
| `WEB_PROVIDER_ERROR` | 网络、格式或上游工具失败；错误刻意不返回上游 body / cause |
| 多窗口保存冲突 | 刷新当前选择 / 设置后重做修改，避免覆盖别处更新 |

网络传输拒绝重定向，响应上限 2 MiB。UI 不展示不可用连接，但不会据此修改已保存选择。空白会话首消息前没有独立搜索选择器，由新会话默认处理。插件不接管 `web_fetch`。源码依据见 [config.ts](../src/config.ts)、[service.ts](../src/search/service.ts)、[structured.ts](../src/adapters/structured.ts)、[protocols.ts](../src/protocols.ts)。
