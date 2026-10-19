# 配置参考

本文是 dsh-web-search-enhanced 0.1.10 全部设置的参考。日常使用只需设置页（**插件 → 已安装插件 → 增强网页搜索**）；需要手写 profile、排查问题或批量部署时再看本文。升级相关的变化见[升级指南](upgrading.md)。

## 设置存放在哪里

插件的设置是 DSH profile 中 `web-search-enhanced` 条目的 `config`。安装补丁（[cordis.patch.yml](../cordis.patch.yml)）插入这个条目，并把新会话的默认连接设为 `builtin:exa`：

```yaml
- id: web-search-enhanced
  config:
    version: 2
    defaultConnection: builtin:exa
    freshness: auto
```

设置是**稀疏**的：内置连接的所有默认值来自插件自带的目录，配置里只保存与默认不同的字段。设置页也按这个规则写入，把某项改回默认值会删除对应字段，而不是写入一份副本。设置页底部的「恢复默认设置」会删除用户层中本插件的全部字段（包括自定义连接），已保存的密钥不受影响。查看合成后的实际配置：

```sh
dsh --profile web --dump-config
```

除 `providerId` 外，所有字段在运行中生效，修改后不需要重启插件。不合法的修改会被拒绝保存；如果配置在别处被改坏，搜索会报 `WEB_SEARCH_CONFIG_INVALID`，普通对话不受影响。

## 顶层字段

| 字段 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `version` | `2` | 省略时视为 2 | 设置格式版本，与插件版本无关。含 0.0.x 旧字段的配置被视为版本 1 并自动迁移（见[升级指南](upgrading.md#从-00x-升级)）；比 2 更新的版本会被拒绝 |
| `defaultConnection` | 连接 ID | 无（安装补丁设为 `builtin:exa`） | 新会话的默认连接，见[新会话用哪个连接](#新会话用哪个连接) |
| `freshness` | `auto` / `fresh` / `realtime` | `auto` | 新会话的内容实时性，见[内容实时性](#内容实时性) |
| `showSelector` | 布尔 | `true` | 是否在输入框显示搜索按钮。关闭后仍可用 `/setup-search` 切换 |
| `connections` | 连接 ID → 对象 | `{}` | 内置连接的覆盖项和自定义连接 |
| `providerId` | 字母或数字开头，最多 128 个字母、数字、`.`、`_`、`-` | `deepseek-official` | 注册到 DSH `web` 服务的搜索 provider ID，`web.searchProvider` 用它选择本插件。只能在 Profile 中修改，修改后插件重新挂载；设置页不显示也不改动它。见[provider ID 与原生搜索共存](#provider-id-与原生搜索共存) |

`defaultConnection` 可以指向不存在或已停用的连接，配置仍然有效；使用它的会话搜索时会报 `WEB_SEARCH_CONNECTION_INVALID`。

## 内置连接

每个内置搜索服务对应一个 `builtin:<adapter>` 连接，另有 `builtin:session-model`（跟随会话模型）。下表来自 [src/catalog.ts](../src/catalog.ts) 与 [src/search/adapters/](../src/search/adapters/index.ts)：

| 连接 ID | 名称 | 默认访问方式 | 免密钥路由 | 个人密钥 / 账号路由 | 默认凭据引用 | 单次结果上限 |
| --- | --- | --- | --- | --- | --- | --- |
| `builtin:exa` | Exa | 免密钥 | MCP `https://mcp.exa.ai/mcp`，工具 `web_search_exa` | `POST https://api.exa.ai/search`，`x-api-key` | `EXA_API_KEY` | 100 |
| `builtin:firecrawl` | Firecrawl | 免密钥 | `POST https://api.firecrawl.dev/v2/search`，不带认证 | 同一地址，`Authorization: Bearer` | `FIRECRAWL_API_KEY` | 100 |
| `builtin:tavily` | Tavily | 免密钥 | `POST https://api.tavily.com/search`，带 `x-tavily-access-mode: keyless` | 同一地址，`Authorization: Bearer` | `TAVILY_API_KEY` | 20 |
| `builtin:tinyfish` | Tinyfish | 免密钥 | MCP `https://agent.tinyfish.ai/mcp`，工具 `search`，带 `x-tinyfish-access-mode: keyless` | `GET https://api.search.tinyfish.ai`，`x-api-key` | `TINYFISH_API_KEY` | 单页结果 |
| `builtin:deepseek` | DeepSeek | 个人密钥（或账号） | 无 | `POST https://api.deepseek.com/v1/tools/search`；账号会话用 `x-dsh-auth-token`，否则 `Authorization: Bearer` | `DEEPSEEK_API_KEY` | 50（未指定时 10） |
| `builtin:openalex` | OpenAlex | 免密钥 | `GET https://api.openalex.org/works` | 同一地址，密钥放在 `api_key` 查询参数 | `OPENALEX_API_KEY` | 100 |
| `builtin:semanticscholar` | Semantic Scholar | 个人密钥 | 无 | `GET https://api.semanticscholar.org/graph/v1/paper/search`，`x-api-key` | `SEMANTIC_SCHOLAR_API_KEY` | 100 |
| `builtin:session-model` | 跟随会话模型 | 会话模型的密钥 | 无 | 见[跟随会话模型](#跟随会话模型) | 来自模型配置 | — |

结果数量由 `web_search` 工具请求决定，插件只按上表截断，不翻页。设置页按上表顺序列出服务；输入框菜单把搜索服务和模型搜索分组显示，缺少密钥或当前不可用的连接注明原因，点击后打开插件设置页。

### 访问方式

| 访问方式 | 适用 | 行为 |
| --- | --- | --- |
| `keyless`（免密钥） | Exa、Firecrawl、Tavily、Tinyfish、OpenAlex | 使用服务的公共接口，共享限额。从不读取、也从不发送你的密钥 |
| `api-key`（个人密钥） | 所有搜索服务、模型连接 | 搜索时从 DSH 凭据读取 `credentialRef` 指向的密钥 |
| `account`（DeepSeek 账号） | DeepSeek | 不是配置项：会话使用 DeepSeek 账号登录的模型（`deepseek-account` 路由）且账号能提供令牌时自动使用，否则改用 `DEEPSEEK_API_KEY` |

内置服务在支持免密钥时默认免密钥。保存密钥**不会**自动切换访问方式，需要在设置页把该服务的访问方式切换为个人密钥，或写 `access: api-key`。免密钥请求被拒绝或限流时，插件不会自动改用个人密钥或其他服务。

### 内置连接的覆盖项

`builtin:<adapter>` 只接受以下字段，其他字段（包括 `endpoint`）会被拒绝：

| 字段 | 说明 |
| --- | --- |
| `label` | 显示名称，非空 |
| `disabled` | `true` 时停用，菜单中不再显示 |
| `access` | `keyless` 或 `api-key`；没有免密钥路由的服务不能设为 `keyless` |
| `credentialRef` | 改用其他凭据引用 |
| `options` | 请求参数，见下表 |

```yaml
- id: web-search-enhanced
  config:
    connections:
      builtin:exa:
        access: api-key
        options:
          type: fast
      builtin:tinyfish:
        disabled: true
```

### 请求参数白名单

每个服务只接受下表中的参数。取值不合法，或在免密钥路由上不可用时，整份配置会被拒绝，即使该连接已停用。参数附加到每次请求，不能覆盖查询词和结果数量。

| 服务 | 参数 | 接受的值 | 免密钥时 |
| --- | --- | --- | --- |
| Exa | `type` | `auto`、`fast`、`instant` | 不可用 |
| Firecrawl | `country` | 两个英文字母，如 `us` | 可用 |
| Firecrawl | `location` | 1–200 个字符，不含控制字符 | 可用 |
| Firecrawl | `safe` | 布尔 | 可用 |
| Tavily | `search_depth` | `basic`、`advanced`、`fast`、`ultra-fast` | 可用 |
| Tavily | `topic` | `general`、`news`、`finance` | 可用 |
| Tinyfish | `location` | 两个英文字母 | 可用 |
| Tinyfish | `language` | 2–3 个字母，可带 `-` 和 2–4 个字母的后缀，如 `zh-CN` | 可用 |
| Tinyfish | `purpose` | 1–2000 个字符，不含控制字符 | 可用 |
| Tinyfish | `domain_type` | `web`、`news`、`research_paper` | 只能用 `web`、`news` |
| DeepSeek | — | 无参数 | — |
| OpenAlex | `sort` | `字段:asc` 或 `字段:desc`，可用逗号连接多个，如 `cited_by_count:desc` | 可用 |
| OpenAlex | `filter` | 1–500 个字符，如 `publication_year:2024` | 可用 |
| OpenAlex | `is_oa` | 布尔，合并进 `filter`（`is_oa:true`） | 可用 |
| OpenAlex | `mailto` | 电子邮箱；未设置时使用插件的公共联系邮箱 | 可用 |
| Semantic Scholar | `year` | `2024` 或 `2018-2024` | — |
| Semantic Scholar | `fieldsOfStudy` | 字母、空格和逗号，1–100 个字符 | — |
| Semantic Scholar | `publicationTypes` | 字母和逗号，1–100 个字符 | — |

设置页只显示当前访问方式可用的参数，免密钥时会提示还有参数需要个人密钥。参数修改后自动保存：选择项立即保存，文本在输入完成且合法时保存，留空即恢复默认。

## 自定义搜索服务

自定义连接的 ID 形如 `custom:<名称>`：`custom:` 后接 1–100 个字符，首字符为字母或数字，其余可用字母、数字、`.`、`_`、`-`。自定义搜索服务复用一个内置服务的请求格式，**总是使用个人密钥**。在设置页添加时，`custom:` 前缀是固定的，只需填写后半部分；可以顺便填入 API Key，连接保存后写入 DSH 凭据。移除自定义连接前会要求确认，已保存的密钥不会被删除。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `kind` | 是 | `structured` |
| `label` | 是 | 显示名称 |
| `adapter` | 是 | `exa`、`firecrawl`、`tavily`、`tinyfish`、`deepseek`、`openalex`、`semanticscholar` 之一 |
| `credentialRef` | 是 | 凭据引用；设置页按 ID 建议一个，如 `custom:team-tavily` → `CUSTOM_TEAM_TAVILY_API_KEY` |
| `endpoint` | 否 | 省略时使用该服务的官方地址 |
| `trustedEndpoint` | 非官方地址时必填 | 设为 `true` 表示你同意把查询词和密钥发送到该地址 |
| `disabled` | 否 | 停用 |
| `options` | 否 | 与该服务个人密钥路由相同的参数白名单 |

```yaml
- id: web-search-enhanced
  config:
    connections:
      custom:team-tavily:
        kind: structured
        label: 团队 Tavily
        adapter: tavily
        credentialRef: TEAM_TAVILY_API_KEY
        options:
          topic: news
```

`endpoint` 和下文的 `baseURL` 必须是绝对 `http(s)` 地址，不能包含用户名密码、查询串或片段。`trustedEndpoint` 只是你的确认，插件不会检测地址是否安全，建议使用 HTTPS。

## 固定搜索模型

固定搜索模型通过模型服务端的搜索工具检索，返回模型的回答文本和引用来源。

```yaml
- id: web-search-enhanced
  config:
    connections:
      custom:work-search:
        kind: model
        label: 团队搜索模型
        trustedEndpoint: true
        binding:
          mode: fixed
          protocol: openai-responses
          model: YOUR_SEARCH_CAPABLE_MODEL
          baseURL: https://api.openai.com/v1
          credentialRef: SEARCH_MODEL_API_KEY
        options:
          searchContextSize: medium
```

`kind: model` 必须带 `trustedEndpoint: true` 和完整的 `binding`（`mode: fixed`、`protocol`、`model`、`baseURL`、`credentialRef`）。请求地址由 `baseURL` 和协议决定：

| `protocol` | 请求地址 | 默认搜索工具 |
| --- | --- | --- |
| `anthropic-messages` | 去掉末尾的 `/v1` 后追加 `/v1/messages` | `web_search_20260209` |
| `openai-responses` | 追加 `/responses` | `web_search` |
| `openai-chat-completions` | 追加 `/chat/completions` | `web_search_options` |

`baseURL` 已经以上述路径结尾时不再追加。OpenAI 协议的 `/v1` 需要写在 `baseURL` 里。请求带 `Authorization: Bearer <Key>`，Anthropic 另带 `x-api-key` 与 `anthropic-version`。协议兼容不代表模型或网关实现了服务端搜索；模型没有执行搜索时报 `WEB_PROVIDER_RESPONSE_INVALID`。

### 模型搜索参数

| 参数 | 默认 | 作用 |
| --- | --- | --- |
| `maxTokens` | 4096 | 输出上限：Anthropic `max_tokens`、Responses `max_output_tokens`、Chat `max_tokens` |
| `maxUses` | 5 | Anthropic 搜索工具的 `max_uses` |
| `apiVersion` | `2023-06-01` | Anthropic 的 `anthropic-version` 请求头 |
| `searchContextSize` | 不发送 | `low` / `medium` / `high`，用于 Responses 与 Chat Completions |
| `chatSearchMode` | `search-model` | Chat Completions：`search-model` 发送官方的 `web_search_options` 字段；`vendor-options` 改用 `toolIdentifier` 作为字段名 |
| `toolIdentifier` | 见上表 | Anthropic / Responses 的搜索工具类型，或 Chat 的厂商字段名；字母开头，可含字母、数字、`_ . : -`，最长 128 |

数字参数为正整数。设置页按协议只显示相关参数。

## 跟随会话模型

`builtin:session-model` 用当前会话正在使用的模型和它的凭据搜索。它只接受两个覆盖项：`disabled` 停用该连接；`optionsByProtocol` 按协议设置[模型搜索参数](#模型搜索参数)。

```yaml
- id: web-search-enhanced
  config:
    connections:
      builtin:session-model:
        optionsByProtocol:
          anthropic-messages:
            maxUses: 3
          openai-responses:
            searchContextSize: low
```

搜索路由只从 DSH 公开的模型配置中推导（`llm.listConfigurableProviders()` 及其指向的设置项），规则如下（[src/host/follow-model.ts](../src/host/follow-model.ts)）：

| 项目 | 规则 |
| --- | --- |
| 使用哪个模型 | 发起这次搜索的模型请求所用的 provider / model |
| provider | 必须出现在 DSH 的可配置 provider 列表中 |
| 协议 `api` | **必须显式写出**：先看该模型自己的条目（`models` 中同 `id` 的项或 `modelOverrides.<模型>`），再看 provider 配置。接受 `anthropic-messages`、`openai-responses`、`openai-completions`（或 `openai-chat-completions`） |
| 地址 `baseURL` | 模型条目 → provider 配置 → provider 声明的默认地址 |
| 凭据 | provider 的 `apiKeyEnv`；未设置时，若 provider 不是 OAuth 登录且只声明了一个原生环境变量，则使用它 |
| 不支持 | provider 配置里写了明文 `apiKey`；provider 或模型设置了自定义 `headers`；OAuth / 订阅登录且没有 `apiKeyEnv` |
| 冻结时机 | 路由信息在每个请求步骤开始时复制一次；同一步内修改模型配置不影响该步的搜索 |

条件不满足时，菜单中该连接显示为不可用，并附英文原因，搜索报 `WEB_SEARCH_FOLLOW_UNSUPPORTED`。DSH 自带的 DeepSeek 路由（API Key 与账号登录）的配置里没有 `api` 字段，因此不能跟随；要用 DeepSeek 搜索，请选择 **DeepSeek** 连接。

## 内容实时性

实时性是**内容缓存偏好**，不是发布日期过滤。它按会话保存，切换连接时保留；fork 出的会话首次使用时继承父会话的当前值。

| 模式 | Firecrawl（两种访问方式） | Exa（个人密钥） | 其他连接 |
| --- | --- | --- | --- |
| `auto` 自动 | 服务默认 | 服务默认 | 服务默认 |
| `fresh` 优先新鲜 | 内联抓取 Markdown，`scrapeOptions.maxAge` = 86400000 毫秒 | `contents.maxAgeHours` = 24 | 忽略 |
| `realtime` 优先实时 | 同上，`maxAge` = 0 | `contents.maxAgeHours` = 0 | 忽略 |

Firecrawl 在非 `auto` 模式下只用抓取到的正文作为摘要，抓取缺失时宁可留空，也不用旧的搜索摘要代替。抓取会增加耗时和额度消耗。所选连接不支持时，菜单中的实时性选项不可用，并提示这一偏好不会生效。

## 凭据

密钥只保存在 **DSH 凭据**中，设置里只有引用名（`credentialRef`，格式 `[A-Za-z_][A-Za-z0-9_]*`）。不要把密钥写进 YAML、`options` 或地址。设置页的密钥输入框只写入新值，不回显已保存的值，也不能删除。

- 同一引用名可以被多个连接共用。DeepSeek 连接默认使用 `DEEPSEEK_API_KEY`，与 DSH「模型」页的 DeepSeek 密钥是同一个。
- DSH 0.2.1 起，凭据存储（本地为 `$DSH_HOME/.credentials.yaml`）中的值优先于启动环境变量、`<启动目录>/.env` 和 `$DSH_HOME/.env`。存储里已有值时，修改环境变量不会生效。
- 值来自环境变量等 DSH 无法写入的来源时，设置页的密钥输入框为只读。
- 密钥在每次搜索时读取，撤销或更换后下一次搜索立即生效。

## 新会话用哪个连接

一个会话第一次需要搜索选择时，按以下顺序决定：

1. 从已有会话 fork 出来（seeded fork）：继承父会话当前的连接和实时性，之后各自独立。
2. 当前模型有**配对记录**，且记录的连接仍存在并已启用：使用它。记录为「不使用搜索」时也照做。
3. `defaultConnection`。
4. 未设置默认连接时：恰好只有一个可用连接就用它，否则关闭搜索。

在会话里手动选择之前，会话持续跟随上述结果，例如切换模型或修改默认连接后会更新；手动选择一次后就固定下来。实时性取 `freshness`，之后不再随默认值变化。

**配对记录**：在会话里选择一个连接（或不使用搜索）时，插件记下「当前模型 → 这个选择」。记录保存在 DSH 存储的 `web_search_enhanced` 域 `pairings` 表中，以 provider 和 model 为键；只改实时性不会更新配对。

## provider ID 与原生搜索共存

`web_search` 由 `web` 条目的 `searchProvider` 选择 provider；没有写时读环境变量 `DSH_WEB_SEARCH_PROVIDER`；都没有时在所有可用的 provider 中自动选择，多于一个就报 `WEB_PROVIDER_AMBIGUOUS`。

| 部署方式 | 本插件 `providerId` | 原生 `web-search-deepseek` | `web.searchProvider` |
| --- | --- | --- | --- |
| 默认 | `deepseek-official` | 停用（安装补丁） | `deepseek-official`（base 自带，无需修改） |
| 共存 | 另选一个，例如 `enhanced-search` | 启用 | 与 `providerId` 相同 |

默认部署占用原生 DeepSeek 搜索的 ID，不改动 `web` 条目。DeepSeek 搜索可以直接用本插件的 `builtin:deepseek` 连接；只有确实要保留原生的 DeepSeek Messages 搜索（例如还要用 DSH 自带的「网页搜索」设置页）时，才在 Profile 的 `cordis.patch.yml` 中改为共存：

```yaml
# 重新启用原生 DeepSeek 搜索
- id: web-search-deepseek
  disabled: false

# 在本插件已有的条目中加上 providerId，其他字段保持不变
- id: web-search-enhanced
  config:
    providerId: enhanced-search
    defaultConnection: builtin:exa

# 补丁会整体替换 web 条目的 config：两个字段都要写，否则另一个会丢失
- id: web
  config:
    searchProvider: enhanced-search
    fetchProvider: http
```

注意：

- `fetchProvider` 写实际使用的抓取 provider：DSH 自带的本地抓取和 dsh-web-fetch-enhanced 都是 `http`。
- 两个 provider 不能注册同一个 ID。重新启用原生条目却没有改 `providerId` 时，两者之一注册失败，报 `WEB_DUPLICATE_PROVIDER`。
- 共存时 DSH 自带的「网页搜索」页面会重新出现。它的「启用新版 Web 搜索 API」开关会改写用户层的 `web` 条目：打开时搜索改由 DeepSeek Search API 提供；关闭时写回 `deepseek-official`，指向原生搜索而不是本插件，需要再把 `searchProvider` 设为 `providerId`。

### 设置页的提示

`web_search` 不经过本插件时，设置页顶部会给出提示，判断方式与 DSH 相同（先看 `web.searchProvider`，再看 `DSH_WEB_SEARCH_PROVIDER`）：

| 情况 | 提示 |
| --- | --- |
| 都没有指定 | 搜索会自动选择，存在多个可用 provider 时失败 |
| 指定为 `deepseek-search-api` | DSH 自带「网页搜索」页面的开关留下的设置，并说明如何改回 |
| 指定为其他 ID | 搜索由那个 provider 提供，并给出本插件的 `providerId` |

出现提示时，设置页的修改和各会话在输入框中的选择都不生效。`web` 条目对当前客户端不可见时不提示。

## 错误码

搜索失败时，模型收到带错误码的英文说明。插件自己的错误码：

| 错误码 | 含义 | 怎么办 |
| --- | --- | --- |
| `WEB_SEARCH_NOT_SELECTED` | 当前会话选择了不使用搜索 | 在输入框搜索按钮或 `/setup-search` 中选择连接 |
| `WEB_SEARCH_CONNECTION_INVALID` | 会话选中的连接已被删除或停用 | 恢复该连接，或为会话另选一个 |
| `WEB_SEARCH_FOLLOW_UNSUPPORTED` | 跟随会话模型无法推导出搜索路由，错误中写明原因 | 按[跟随会话模型](#跟随会话模型)补全 provider 配置，或改用其他连接 |
| `WEB_PROVIDER_CREDENTIAL_MISSING` | 引用的密钥未配置 | 在设置页保存密钥，或改用免密钥连接 |
| `WEB_KEYLESS_UNAVAILABLE` | 服务拒绝了来自当前网络的匿名访问（HTTP 401/403） | 换一个免密钥连接，或配置个人密钥并切换访问方式 |
| `WEB_PROVIDER_AUTH_ERROR` | 密钥或 DeepSeek 账号登录被拒绝（HTTP 401/403） | 检查密钥是否属于该服务；账号登录过期时重新登录 |
| `WEB_PROVIDER_ACCESS_ERROR` | 服务拒绝请求（HTTP 402），通常是余额或权限不足 | 检查服务账户 |
| `WEB_PROVIDER_RATE_LIMITED` | 服务限流（HTTP 429） | 稍后再试或换连接 |
| `WEB_PROVIDER_TIMEOUT` | 90 秒内没有完成 | 稍后再试或换连接 |
| `WEB_ABORTED` | 搜索被取消 | — |
| `WEB_PROVIDER_ERROR` | 网络失败、重定向、其他 HTTP 错误、响应超过 2 MiB 或服务报告错误 | 稍后再试或换连接 |
| `WEB_PROVIDER_RESPONSE_INVALID` | 响应格式无法识别；对模型连接也表示模型没有执行搜索 | 确认服务地址正确、模型支持服务端搜索 |
| `WEB_SEARCH_CONFIG_INVALID` | 设置不合法，错误中写明字段 | 按提示修正设置 |
| `WEB_SEARCH_MIGRATION_REQUIRED` | 0.0.x 旧设置尚未迁移完成 | 查看宿主日志和 DSH 凭据权限，修正后重启插件 |
| `WEB_SEARCH_STORAGE_UNAVAILABLE` | 无法打开会话选择所在的 DSH 存储 | 下一次请求会自动重试；持续出现时检查 DSH 存储后端 |
| `WEB_SEARCH_CONTEXT_UNAVAILABLE` | 搜索不在会话的模型请求中执行，或读取会话选择时出现意外错误 | 在对话中重新发起请求 |

DSH 自身的相关错误码：

| 错误码 | 含义 | 怎么办 |
| --- | --- | --- |
| `WEB_PROVIDER_CONFIGURED_MISSING` | `web` 配置指向的 provider 不存在，常见于用户层残留的 `searchProvider` / `fetchProvider` 覆盖，或手写过旧的 `enhanced-search` | 删除这条覆盖，见[升级指南](upgrading.md#如果改过内置的网页搜索开关) |
| `WEB_PROVIDER_AMBIGUOUS` | `web` 条目缺少 `searchProvider` 或 `fetchProvider`，且有多个可用 provider | 本插件不改动 `web` 条目；检查其他插件或用户层是否只写了其中一个字段，`web` 条目应同时写明两者。缺少 `searchProvider` 时设置页会提示 |
| `WEB_DUPLICATE_PROVIDER` | 两个 provider 注册了同一个 ID，常见于重新启用 `web-search-deepseek` 却没有修改 `providerId` | 停用原生条目，或按[共存](#provider-id-与原生搜索共存)改用另一个 `providerId` |

在输入框菜单或 `/setup-search` 中切换连接时，还可能看到两种提示：选择已在别处更改（界面会显示最新选择），或所选连接已停用、已移除。

## 传输限制

所有请求（REST、MCP、模型搜索）共用同一套限制（[src/search/http.ts](../src/search/http.ts)）：

- 一次搜索最长 90 秒，包括 MCP 握手。
- 响应体最大 2 MiB。
- 拒绝任何重定向。
- 不自动重试，不翻页，不在服务、访问方式或协议之间回退。
- 错误信息不包含上游响应体或底层异常。
- 来源只保留不含账号信息的 `http(s)` 地址；同一地址只出现一次；标题最长 1000 字符，摘要最长 4000 字符；日期只保留 ISO 8601 格式。
