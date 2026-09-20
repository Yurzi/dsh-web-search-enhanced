# dsh-web-search-enhanced — V2 工作分支

DSH 原生 web_search 的会话级搜索连接插件。此分支尚未发布，版本号保持 0.0.6；npm 上的 0.0.6 不是本分支产物。

## 当前实现与边界

- **已有 Session**：通过官方 conversation.input.right 列表槽追加搜索连接选择器，不替换对话模型或 composer。Session 独立选择，服务端持久化及 revision 冲突检查，切换影响后续推理 step。
- **结构化搜索**：Firecrawl、Exa、Tavily、Tinyfish。目录默认值留在代码，只填写 DSH Credentials 即可配置。
- **固定模型**：Anthropic Messages、OpenAI Responses、OpenAI Chat Completions 共用协议解析器。协议兼容不意味着模型支持服务端搜索，请核实能力和价格。
- **跟随会话模型**：已接通 Session request header → DSH settings → Credentials。复用旧版路由解析思路，按请求冻结配置，不借用固定连接的 Key，不暗中换服务；具体支持边界见下文。
- **空白会话**：宿主在没有 sessionId 时不渲染该槽，没有首条 prompt 前等待插件草稿的接口；首条消息前的选择器尚未接通。可以预设新会话默认连接。

**首版插件侧功能已实现；空白会话首消息前选择等完整目标仍有边界。** 证据、验证范围与剩余宿主配合项见 [实施记录](docs/v2-implementation.zh-CN.md)。

## Key-only 配置

设置 → 插件 → 搜索连接，展开对应凭据编辑器。只调用 DSH Credentials，不保存目录、不发起探测。

| 连接 ID | 默认 Credential Ref | 目录 endpoint |
| --- | --- | --- |
| builtin:firecrawl | FIRECRAWL_API_KEY | https://api.firecrawl.dev/v2/search |
| builtin:exa | EXA_API_KEY | https://api.exa.ai/search |
| builtin:tavily | TAVILY_API_KEY | https://api.tavily.com/search |
| builtin:tinyfish | TINYFISH_API_KEY | https://api.search.tinyfish.ai |
| builtin:session-model | 当前 provider 的 apiKeyEnv | 当前 provider 的地址／目录默认，不保存副本 |

“已配置”仅表示本地凭据齐备，**不是健康或余额验证**。没有 Key 不阻止普通聊天。安装不会遍历服务请求。内置地址不能覆盖；自建地址使用自定义连接，并显式确认信任。

## 稀疏偏好与实时性

~~~yaml
web-search-enhanced:
  version: 2
  defaultConnection: builtin:exa
  freshness: realtime
~~~

默认连接只用于 Session 首次初始化。没有默认且恰好一个本地可用连接时才自动选择；零个或多个保持未选择。失效的默认/会话 ID 保留并明确报错，不选别的服务。

| freshness | Firecrawl | Exa | Tavily / Tinyfish / 模型 |
| --- | --- | --- | --- |
| auto | 普通 web 结果 | 默认内容缓存策略 | 忽略，不注入虚构参数 |
| fresh | 内联 markdown，maxAge 24 小时 | contents.maxAgeHours = 24 | 同上 |
| realtime | 内联 markdown，maxAge = 0 | contents.maxAgeHours = 0 | 同上 |

切换连接不会重置顶层 freshness。偏好不保证页面可抓取或实时；缺少正文时不冒充实时内容。优先新鲜/实时可能增加费用和延迟。数量截断不表示新鲜度达标。插件只在私有、有界、无查询/Key 的诊断中记录 applied / ignored / partial，不伪装成 DSH 结果扩展字段，也不声称已验证实际新鲜度。

## 跟随会话模型

选择 builtin:session-model，或把它设为新会话默认。不必重复填写模型、地址或 Key。

- 当前工具调用的 exec.agent.session.requestHeader().config 决定 provider/model；尚无 header 时才读取同一 agent 的 options，不混拼不完整 header。
- 从 settings 的 llm-pi-ai.providers[provider] 读取 api、baseURL、apiKeyEnv。支持 anthropic-messages、openai-responses、openai-completions（映射为 openai-chat-completions）和 openai-chat-completions。
- api/baseURL 缺省时，可通过已安装 pi-ai adapter 的只读目录补齐。此兼容入口仅用于目录默认值；显式配置不依赖它，接口缺失只影响缺省值补齐。
- **首版要求 provider 显式配置 apiKeyEnv**，通过 DSH Credentials.resolve 读取；不重建 pi-ai scoped credential record、OAuth/订阅或 ambient auth。已有显式引用无需重新保存 Key。
- 有自定义 headers、非 HTTP 传输、非法地址或未知协议时明确拒绝；不把其他认证秘密复制到快照。当前 rc.2 的 model entries/modelOverrides 不支持单独覆盖 endpoint、协议或 Key，插件也不虚构这些字段。
- agent/request 冻结无密钥 provider 配置，同一步重试不重取；实际工具执行按已提交 provider/model 整体解析，多个查询复用绑定。设置变化在下一新 step 采样，adapter 替换或移除使旧请求明确失败。
- 普通三协议路由不需要修改宿主。模型仍须支持相应服务端搜索；“已配置”不是能力或额度保证。

## 固定模型与额外实例

高级 JSON 编辑器支持新建/编辑，并单独勾选 endpoint 信任确认，服务器仍严格校验。示例不是模型搜索能力保证：

~~~yaml
web-search-enhanced:
  version: 2
  defaultConnection: custom:search-model
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
~~~

模型 options：apiVersion、toolIdentifier、maxTokens、maxUses、chatSearchMode、searchContextSize。没有任意 headers/body 透传。Anthropic 默认标识保留基线的 web_search_20260209，不保证适用于全部 compatible 网关。

额外结构化实例使用 custom:<id>、kind: structured、adapter、credentialRef、可选 endpoint/options。非目录地址必须 trustedEndpoint: true。首期 options 白名单：

- Firecrawl：country、location、safe。
- Exa：type = auto / fast / instant。
- Tavily：search_depth、topic。
- Tinyfish：location、language、purpose、domain_type。

不开放覆盖 freshness 的底层参数。Tinyfish 不发送 limit，也不调用 Browser/Agent API；过多结果在本地截断。

## 旧配置迁移

旧全局配置不会自动变成 V2 默认。设置页提供显式导入：

- configured → custom:legacy 固定连接，保留地址、模型、凭据引用和协议参数。
- current-session → builtin:session-model，按当前 Session 的实际路由解析；不支持的具体配置显示原因。
- fallbackModel 不再执行，不跨服务兜底。
- 明文 apiKey 必须先手工移入 DSH Credentials 并从旧配置删除，插件不复制秘密。
- 导入只修改新会话默认，不覆盖已有 Session 选择。重置设置不删除凭据。

旧 resolveConfig/createProvider/EnhancedSearchProvider 辅助导出为兼容保留；V2 安装入口不使用旧全局路由、备用模型或旧请求事件记录。

## 持久化与安全

- 存储域 web_search_enhanced / selections，继承宿主 Storage Domain 后端路由，必须使用持久后端。错误不降级为 localStorage。
- Remote 先经过真实 SessionController.resolveAgent；CAS 在原子 update 内检查，成功在耐久写入后确认。
- 按 agent + turn + step 冻结选择、配置与 freshness；同 step 重试、多查询和 PTC 不重取最新配置。凭据每次由冻结引用重新解析，撤销仍有效。
- 只请求选中服务，禁止重定向，响应最大 2 MiB、超时 90 秒；取消覆盖 HTTP 与凭据等待。错误不包含上游正文、查询 URL、Key 或原始 cause。
- 恢复优先已有记录；fork 首次初始化复制父会话当前选择，不声称重建历史 fork 边界。session/disposed 不是耐久删除；当前保留 orphan 记录，等待明确删除通知。

## 构建与验证

按 DSH 0.1.5-rc.2 实际声明与 JS 接口开发。linked 安装请先禁用插件再构建，避免重载干扰当前会话。

~~~sh
pnpm run check
~~~

本环境 pnpm run 启动器数据库错误仍存在。已安装工具的等价步骤：

~~~sh
./node_modules/.bin/tsc -p tsconfig.json --noEmit
./node_modules/.bin/vitest run
node scripts/clean.mjs
./node_modules/.bin/tsc -p tsconfig.build.json
./node_modules/.bin/tsdown --config tsdown.config.ts
node scripts/verify-package.mjs
./node_modules/.bin/vitest run
~~~

测试使用 fixture/mocked transport，没有真实供应商账号调用。GUI、完整 LLM 循环、真实 worker-thread 和 HTTP/WebSocket 载体需要另验。构建通过不等于运行中的 GUI 已更新。

## API 参考与设计

- [Firecrawl Search](https://docs.firecrawl.dev/api-reference/endpoint/search.md)
- [Exa Search](https://exa.ai/docs/reference/search.md)
- [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search.md)
- [Tinyfish Search](https://docs.tinyfish.ai/search-api/reference.md)
- [收敛设计](docs/design-v2.converged.zh-CN.md) · [实施记录](docs/v2-implementation.zh-CN.md) · [MIT](LICENSE)
