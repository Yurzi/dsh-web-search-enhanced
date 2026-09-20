# Web Search Enhanced V2：收敛后的需求与架构设计

> 状态：设计提案，尚未实现。已核对本机 DSH 接口和首批服务官方 API，未进行真实认证请求或运行集成测试。
> 范围：会话级连接选择、按需配置、顶层实时性、两种模型绑定，以及 Firecrawl、Exa、Tavily、Tinyfish。
> 本文为新的设计基线，不覆盖旧文档。示例字段属于拟议 V2，不是当前插件已支持的配置。

## 1. 产品定义与核心决策

插件是 **DSH 的会话级搜索连接管理器**，不是全局搜索开关，也不是另一个搜索 Agent。

~~~text
一个 Session = 独立选择的对话模型 × 独立选择的搜索连接
一次搜索 = 会话选择 + 全局实时性偏好 + 对应适配器
~~~

确定以下设计：

1. **会话切换是 P0**：在输入区提供与模型选择并列的搜索连接选择器，不要求进入设置页。
2. **模型连接有两种**：配置中固定模型与协议；内置的“跟随会话模型”。后者是用户显式选择的动态连接。
3. **首批结构化连接**：Firecrawl、Exa、Tavily、Tinyfish，均调用专门的 Search API。
4. **内置目录、稀疏配置**：服务地址、默认参数、凭据引用约定随插件发布，不把全部后端物化到用户配置文件。
5. **标准后端只需 Key**：通过 DSH Credentials 配置对应 Key，即可让内置结构化连接变为可用，无需另写 endpoint 或 enabled。
6. **实时性是顶层全局偏好**：切换连接不重置；不支持的适配器忽略，不报错、不自动换服务。
7. **保持 DSH 契约**：只注册一个 `enhanced-search` Provider，保持原生 `web_search({ queries })` 与 `WebSearchResult`。
8. 首期不做跨后端自动兜底、多引擎融合、额外模型总结、插件搜索缓存或动态第三方适配器加载。

## 2. 用户体验

### 2.1 输入区的平级选择器

~~~text
[ 模型：当前对话模型 ▾ ]  [ 搜索：Exa ▾ ]

搜索连接（仅影响当前会话）
────────────────────────────────────
模型搜索
  ○ 跟随会话模型        → 当前模型 / 当前协议
  ○ 专用搜索模型        固定模型 / 固定协议

结构化搜索
  ● Exa
  ○ Firecrawl
  ○ Tavily
  ○ Tinyfish
────────────────────────────────────
内容实时性：优先实时 · 全局偏好
管理搜索连接…
~~~

- 模型搜索/结构化搜索只是分组，不增加一层必须先切换的模式。
- 已配置连接优先显示；未配置后端放入“添加连接”，点击后只要求必要凭据，不同时展开四套大表单。
- “跟随会话模型”始终可发现；是否可执行取决于本会话实际路由。不可用时显示原因和其他连接入口。
- 固定模型或结构化连接被选中时，切换聊天模型不改变搜索连接。
- 选中“跟随会话模型”时，连接 ID 不变，但解析出的模型、协议、地址和凭据绑定随本会话有效模型变化。
- 实时性只显示全局状态与设置入口，不在每个连接编辑器复制一份。
- 支持键盘操作、清晰选中态、可访问标签及窄屏布局。

### 2.2 切换的生效时机

**与模型选择的体验对齐：影响下一次模型请求，不修改已经由某次模型请求派生的工具调用。** 一个 turn 可能包含多个模型推理 step，因此不将整个 turn 永久冻结。

- Host 保存当前 Session 的下一请求选择；成功响应后 UI 才确认选中。
- 当前正在执行时显示“已选择 Tavily，下一次模型请求生效”。已发出的搜索继续使用旧快照。
- 同一模型推理 step 派生的多个搜索，以及一次 `queries[]` 的多个子查询，使用同一连接选择和实时性快照；同一 step 的网络重试不重新采样用户选择。
- 两个 Session 并发时互不影响；同一 Session 的多窗口写入使用 revision 检测冲突并同步状态。
- 会话切换不隐式修改全局默认连接。菜单提供独立的“设为新会话默认”动作。
- 未配置搜索不阻断普通聊天；真正调用搜索时才返回可操作的配置错误。

### 2.3 新会话、恢复与失效

初始选择顺序：

1. 使用明确配置的 `defaultConnection`。失效时显示失效状态，不自动换服务。
2. 没有显式默认且恰好一个连接在当前上下文可用时，可作为初始候选，明确显示，并在会话初始化时确认保存。
3. 多个连接可用时让用户选择；零个时显示“配置搜索连接”。不按注册顺序选择，不强制默认为跟随模型。

已有 Session 恢复自身 connectionId，不重新套用后来改变的默认值。连接被删除或 Key 撤销时保留失效 ID 与修复入口，避免查询被悄悄发送到另一家服务。

空白页尚无 sessionId 时，选择属于新会话草稿。创建 Session 后、首条 prompt 发送前，必须等待选择写入成功；失败保留草稿并允许重试，不能越过失败以另一个连接发送。

### 2.4 设置页

~~~text
通用偏好
  新会话默认搜索连接   [ Exa ▾ ]
  内容实时性           [ 自动 / 优先新鲜 / 优先实时 ]

内置结构化连接
  Firecrawl    未配置       [配置 Key]
  Exa          已配置       [管理凭据] [测试]
  Tavily       已配置       [管理凭据] [测试]
  Tinyfish     未配置       [配置 Key]

模型搜索连接
  跟随会话模型             无需重复填写模型、协议或 Key
  专用搜索模型             [编辑]
  [添加固定模型连接]

高级
  自定义地址、独立账号、协议专用选项
~~~

“已配置”仅表示本地配置与凭据齐备，不代表远端权限、余额或健康状态已经验证。“测试”是用户主动触发的联网操作，可能消耗服务额度。

## 3. 领域模型与数据归属

执行领域保留两个核心对象：**Connection** 和 **Adapter**。Catalog、会话选择、全局偏好是配置来源，不建设多层路由框架。

### 3.1 Connection

三种配置形状最终解析为相同的执行配置：

~~~ts
// 领域示意，非完整可编译 SDK
 type Connection =
   | { kind: 'structured'; adapter: StructuredAdapterId;
       credentialRef: string; options: unknown }
   | { kind: 'model'; binding: { mode: 'fixed';
       protocol: ModelSearchProtocol; model: string;
       baseURL: string; credentialRef: string }; options: unknown }
   | { kind: 'model'; binding: { mode: 'session' };
       optionsByProtocol?: unknown }

 type ResolvedConnection = {
   connectionId: string
   adapterId: string
   config: Readonly<ValidatedAdapterConfig>
   credentialRef: string
 }
~~~

这里的 unknown 只表示各适配器拥有独立 schema，不允许任意字段直接透传。

稳定 ID：

- `builtin:firecrawl`、`builtin:exa`、`builtin:tavily`、`builtin:tinyfish`。
- `builtin:session-model`：显示名固定为“跟随会话模型”，不保存模型和协议副本。
- `custom:<id>`：用户定义的固定模型连接，或结构化服务的额外实例。

### 3.2 Adapter

统一执行接口大致为：

~~~ts
interface SearchAdapter<C> {
  validate(config: unknown): C
  search(
    request: WebSearchRequest,
    config: Readonly<C>,
    context: SearchExecutionContext
  ): Promise<WebSearchResult>
}
~~~

SearchExecutionContext 仅提供 freshness、取消、受控 HTTP、单次凭据访问和诊断，不把整个 DSH Context 交给适配器。

结构化服务各一个适配器；模型适配器按 Anthropic Messages、OpenAI Responses、OpenAI Chat Completions 组织。**固定/跟随只是两种绑定解析方式，不复制两套 HTTP 和响应解析代码。**

### 3.3 数据归属

| 数据 | 位置 | 持久化原则 |
| --- | --- | --- |
| 内置地址、默认参数、名称、凭据引用约定 | 插件只读 Catalog | 不写用户 settings |
| freshness、默认连接、用户覆盖、自定义连接 | DSH settings namespace | 只写差异 |
| Session 的 connectionId / revision | 插件自有 DSH Storage Domain | 按会话保存，不放进 settings |
| API Key | DSH Credentials | 不进入普通配置或日志 |
| 模型请求的搜索快照 | 插件私有内存上下文 | 不含密钥 |

## 4. 内置目录、Key-only 与稀疏配置

### 4.1 不把“已支持”当作“全部启用”

~~~text
Catalog 知道某服务
  ≠ 已有可用凭据
  ≠ 当前 Session 选择了它
  ≠ 已向它发送网络请求
~~~

安装只注册描述和适配器，不写四个完整连接块，不探测网络，不初始化所有 SDK。实现可以按需加载。

对 Catalog 中已知 CredentialRef 调用 DSH credentials.describe 获取无密钥状态，不扫描任意环境变量猜服务。凭据更新事件和 UI 刷新触发状态更新。

### 4.2 默认凭据引用

| 连接 | 插件约定 CredentialRef |
| --- | --- |
| Firecrawl | `FIRECRAWL_API_KEY` |
| Exa | `EXA_API_KEY` |
| Tavily | `TAVILY_API_KEY` |
| Tinyfish | `TINYFISH_API_KEY` |
| 跟随会话模型 | 本次会话有效模型路由的凭据绑定 |

用户通过 DSH Credentials UI/Remote 写 Key，或使用 DSH 凭据服务认可的环境来源。插件统一调用 ctx.credentials.resolve，不另建明文 Key 文件，不自造与宿主不同的 process.env 优先级。

标准内置结构化连接保存 Key 即变为“已配置”，**不需要额外 settings 条目**；保存 Key 不自动选中连接。凭据值每次操作重新解析，不能跨操作缓存。

固定模型连接需要用户确定模型、协议和服务地址；仅靠 Key 无法可靠推导一个任意网关的这些信息。跟随连接直接使用会话绑定，不要求重复输入 Key。

### 4.3 最小配置与高级配置

全部使用默认行为时，允许没有插件 settings 条目。默认 freshness=auto、无显式默认连接、空覆盖集合。

只保存两个偏好即可：

~~~yaml
web-search-enhanced:
  version: 2
  defaultConnection: builtin:exa
  freshness: realtime
~~~

首次有实际配置变更时才同时保存 version，不为版本标记单独制造配置。

需要固定模型或独立账号时才声明实例：

~~~yaml
web-search-enhanced:
  version: 2
  freshness: fresh
  connections:
    "custom:research-model":
      label: 专用搜索模型
      kind: model
      binding:
        mode: fixed
        protocol: openai-responses
        baseURL: https://gateway.example/v1
        model: search-capable-model
        credentialRef: RESEARCH_MODEL_API_KEY
    "custom:exa-work":
      label: Exa 工作账号
      kind: structured
      adapter: exa
      credentialRef: EXA_WORK_API_KEY
    "builtin:tinyfish":
      disabled: true
~~~

网关和模型名是占位值；示例没有明文密钥。选择“跟随会话模型”无需在这里再次声明这个内置连接。

### 4.4 合并和保存规则

- Catalog 默认 → DSH composition base → 用户覆盖。
- 保存时比较继承基准，只写差异；默认值用 unset 恢复，不复制默认对象。
- 内置连接允许 label、disabled、credentialRef 和经 schema 校验的 options，不允许修改 adapter 偷换 ID 含义。
- 自定义 endpoint 必须显式绑定凭据并确认信任，不把内置 Key 默默发送到新 origin。
- freshness 管理的原生字段不允许同时出现在 connection.options 中。
- 未配置某个内置服务的 Key，不能阻断其他连接或插件加载。
- 删除凭据、禁用连接、恢复默认是不同动作，不能互相代替。
- 配置大小随用户修改量增长，而不是随插件支持后端总数增长。

## 5. 两种模型搜索连接

### 5.1 固定模型与协议

配置固定 model、protocol、baseURL、credentialRef；不受聊天模型切换影响。协议专用参数放在对应适配器 options，不变成所有连接必填字段。

### 5.2 跟随会话模型

~~~text
发出此次工具调用的有效模型请求
  → provider / model
  → 搜索协议 / endpoint / 认证绑定
  → 对应模型搜索适配器
~~~

规则：

1. 跟随实际请求所属 Session，不使用浏览器全局默认模型或“最近活跃会话”。
2. 模型、协议、endpoint、凭据绑定作为完整路由解析；禁止只跟随模型名却复用旧 Key。
3. 不把解析值写回配置，否则动态连接会变成固定副本。
4. 以已提交 request/header 或等价的实际调用上下文为准；UI 中待生效的模型不能提前污染旧工具调用。
5. DSH 自身回退到另一个实际调用模型时，跟随最终有效路由，不只相信某个中间 Hook 提议值。
6. 协议兼容不等于搜索能力。未知协议、无服务端搜索能力、不可安全解析的认证都显示明确不支持状态。
7. 无会话上下文时拒绝执行，不猜测默认模型，也不自动换成固定连接。
8. 不跨协议沿用 toolIdentifier 等参数；需要高级覆盖时按协议分组。
9. 首期不承诺任意订阅/OAuth 路由都能重建为搜索 API 请求。只支持能够安全解析且具备搜索能力的路由。

不支持搜索不阻断聊天。用户可以在输入区立即切换到结构化连接。当前会话模型的身份不作为权限授权凭据，仍服从宿主工具与会话访问控制。

## 6. 顶层实时性

### 6.1 明确定义，避免错误统一

本稿的 freshness 指 **页面内容的新鲜度和重新获取内容的偏好**，不是“只搜索最近发布的网页”。

必须区分：

- 内容实时性：接受多旧的缓存，是否重新获取页面。
- 发布时间窗口：最近一天/一周发布或更新的结果。
- 检索深度：更多计算、更深入搜索或更多片段。

旧页面也能刚刚被抓取。search_depth=advanced、time_range=day、topic=news 都不等价于强制实时抓取。

### 6.2 统一等级

~~~ts
type Freshness = 'auto' | 'fresh' | 'realtime'
~~~

| 值 | 文案 | 插件语义 |
| --- | --- | --- |
| auto | 自动 | 轻量默认检索，后端默认内容获取策略 |
| fresh | 优先新鲜 | 支持时要求页面内容缓存不超过 24 小时 |
| realtime | 优先实时 | 支持时请求重新获取内容或绕过内容缓存 |

24 小时是本设计的统一档位，不是服务质量保证。偏好不保证源站内容准确，也不保证搜索索引实时更新。

- 顶层值跨连接保留，不复制到每个 Session 或 Connection。
- 改变它影响后续模型请求，不改变已有执行快照。
- 不支持的适配器不发送相关参数，正常执行；不回写 auto，不换后端，不反复弹警告。
- UI 可轻量提示“本连接不支持内容实时性控制，使用服务默认行为”。
- fresh/realtime 可能触发服务端页面获取，增加延迟和额度消耗，设置旁必须说明。

### 6.3 首批映射

| 后端 | auto | fresh | realtime | 能力边界 |
| --- | --- | --- | --- | --- |
| Firecrawl | 默认搜索结果，不额外请求正文 | Search 内联 scraping，scrapeOptions.maxAge=86400000 | 同上，maxAge=0 | 页面抓取缓存，不是索引年龄 |
| Exa | 默认检索及适配器默认有限片段 | contents.maxAgeHours=24 | contents.maxAgeHours=0 | 结果页面内容的新鲜度 |
| Tavily | 默认 Search | 忽略 | 忽略 | 本次核对的 Search 契约无等价内容缓存年龄控制 |
| Tinyfish | 默认 Search | 忽略 | 忽略 | recency_minutes 是结果时间窗口，不是内容缓存控制 |
| 模型连接 | 协议默认搜索 | 仅有已验证原生控制时映射，否则忽略 | 同左 | 不以“请实时搜索”冒充协议级保证 |

Firecrawl 在 fresh/realtime 下必须实际请求受支持的正文格式，并从返回内容提取有界 snippet，不能只返回旧 SERP description 却宣称提供了新抓取内容。Exa 同理，缓存控制必须作用于实际返回的内容。

正文只做有界摘取，不额外调用模型总结。片段截短与来源数量 truncated 分开处理。若上游只返回部分新获取内容，诊断记录 requested / applied / ignored 或 partial，不能把“发送了参数”当作“全部来源已保证实时”；这些信息不伪装成 DSH 输出已有的扩展字段。

不支持的语义直接忽略，不用日期过滤近似替代。以后需要发布时间过滤，应设计独立的通用字段。

官方依据：[Firecrawl Search](https://docs.firecrawl.dev/api-reference/endpoint/search.md)、[Exa Search](https://exa.ai/docs/reference/search.md)、[Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search.md)、[Tinyfish Search](https://docs.tinyfish.ai/search-api/reference.md)。

## 7. 首批四个结构化后端

| Adapter | 使用接口 | 认证 | 结果与数量控制 |
| --- | --- | --- | --- |
| Firecrawl | POST https://api.firecrawl.dev/v2/search | Bearer Key | data.web 的 url/title/description；limit |
| Exa | POST https://api.exa.ai/search | x-api-key | results 的 url/title/highlights/text/publishedDate；numResults |
| Tavily | POST https://api.tavily.com/search | Bearer Key | results 的 url/title/content；max_results |
| Tinyfish | GET https://api.search.tinyfish.ai | X-API-Key | results 的 url/title/snippet；首期 page=0，宿主截断 |

实现边界：

- **Tinyfish 使用专门的 Search API，不使用 Agent/Browser 自动化模拟搜索。** 当前参考文档列出分页但未列结果数量控制，不凭空发送 limit。
- Firecrawl 首期只接 web Search，不自动扩展至 crawl、图片搜索或批量站点抓取。实时性模式只使用 Search 自带的内联 scraping。
- Exa 新实现采用 contents.maxAgeHours，不依赖已标记 deprecated 的 livecrawl，也不同时发送两者。
- Tavily 首期 include_answer=false，不请求额外生成式答案；检索深度与 freshness 分开。
- DSH maxResults 是输出上限。支持请求侧数量控制时按合法范围映射，不支持时保留宿主截断；不自动翻页补齐。
- 时间字段仅在可可靠解释并规范化时进入 publishedAt；估计更新时间不能伪称精确原始发布时间。
- 空结果是合法成功；认证失败、未开通 Search、结构错误不能伪装为空结果。
- 有 Key 不代表有权限、有额度或未限流。失败指向当前连接，不自动改用另一服务。
- 只发送搜索查询及明确配置的参数，不上传完整聊天历史。Tinyfish purpose 不从私有会话自动推断上传。

这些是官方文档核对后的设计，不是已经通过四个服务真实集成测试的声明。

## 8. 执行架构

~~~text
会话输入区：模型选择器         搜索连接选择器
        │                        │
    DSH 模型选择              SessionSearchState
        └──────────┬─────────────┘
                   ▼
        每次模型请求的搜索选择快照
           connection + freshness
                   │
DSH web_search → EnhancedSearchProvider
                   │
              SearchService
           解析固定 / 跟随绑定
           解析单次操作凭据
           执行一个 Adapter
                   │
        模型协议 / 四个 Search API
                   │
          DSH WebSearchResult
~~~

Provider 的同步 available() 只做廉价的本地就绪检查，不发网络请求，也不因某个全局默认连接缺 Key 而关闭所有 Session 的搜索。具体连接与凭据可用性在各自执行上下文中判断。

只保留必要组件：

- Catalog：只读预设、能力和安全的客户端元数据。
- ConnectionResolver：稀疏配置合并与固定/跟随绑定解析，不是通用规划引擎。
- SessionSearchState：授权读写、revision、持久化与生命周期。
- SearchService：快照 → 凭据 → 适配器 → 诊断。
- Adapters：协议与服务差异。
- DSH Bridge：Provider、设置、UI、Remote 和上下文接线。

### 8.1 会话状态

~~~ts
interface SessionSearchSelection {
  connectionId: string | null
  revision: number
}
~~~

使用插件自有 Storage Domain，按真实 Session 身份索引，不放在全局 settings，也不只存浏览器 localStorage。

拟新增插件自己的 get/set Remote，不冒称 DSH 已有 selectSearch。Host 校验会话访问权限、连接 ID 与 expectedRevision；同一 Session 初始化/更新串行化。已存在记录使用 table.update 做原子修改；缺失记录初始化由插件队列保护，不能用并发 get+put 假装 CAS。

成功写入后通知客户端。存储不可用不显示“已保存”；首期依赖耐久宿主 storage backend，不悄悄退化为内存。删除 Session 清理记录，fork 产生独立记录并明确继承选择，不共享可变对象。

插件侧状态不天然包含于原生会话导出，也不能重建全部历史路由；需明确说明，不冒称完整重放能力。

### 8.2 请求级快照与跟随解析

1. 使用公开 agent/request Hook，在模型推理 step 准备阶段捕获已提交的 connectionId、freshness、非密钥连接配置，按 agent/turn/step 保存。不得修改返回的 LLM 配置。
2. 同一 step 重试保留选择快照。后续 step 重新读取，符合“下一次模型请求生效”。这里的模型请求指新的推理 step，而非网络重试次数。
3. Hook 返回值不是通用 metadata。快照保存在插件私有 WeakMap/请求上下文，不向 LlmCallConfig 或 exec 添加不存在的字段。
4. tools/execute around hook 通过 exec.agent 取得快照，用插件私有异步上下文包裹 next()；Provider 从此读取，不能使用全局最后选择。
5. 跟随连接在搜索执行前依据实际已提交 request/header 解析最终路由。模型、协议、endpoint、credentialRef 整体冻结；同一有效模型请求的多个搜索分派复用无密钥解析结果。需要按实际有效请求身份或 header revision 区分宿主回退，不能复用旧路由。
6. 一个 web_search 内部的所有查询共享最终绑定；凭据值仍由每个搜索操作重新解析。撤销凭据可以使下一操作失败，不能触发静默换连接。
7. 缺少快照、热加载进入执行中的请求或归属不明时，搜索明确失败。不得偷读实时全局状态补造历史快照。
8. 取消贯穿解析、凭据等待、HTTP 和响应读取。多查询并发/合并继续交给 DSH。

这是拟议接线，须在原生工具与 PTC 两条路径验证实际 Hook 次序、重试/回退、快照复用和异步上下文隔离。声明里有接口不等于已经完成集成。

无 Session 的直接服务调用可使用显式内部上下文；否则只取明确全局默认或唯一可用连接。跟随连接在无 Session 时拒绝，不使用“最近活跃会话”。

### 8.3 结果、安全和错误

- Adapter 直接输出 WebSearchResult，不建立多层同构 DTO。
- sources 是主体，content 可选；不要求结构化服务生成答案。
- 来源只取真实结构化返回字段，不从模型正文猜 URL。
- 受控 HTTP 负责取消、响应大小限制、错误脱敏与携带凭据请求的重定向拒绝。
- Tinyfish GET URL 含查询；日志和错误不能直接打印完整 URL。
- 区分未选择、缺凭据、跟随不支持、认证/权限、限流、服务故障、非法响应与取消。
- freshness 被忽略是正常能力差异，不是错误。
- 不把所有请求写成 web/deepseek-search-llm-request，不追加宿主未知 Session Event。首期使用独立脱敏诊断。

## 9. DSH 可直接复用的能力与明确缺口

### 9.1 可复用

- conversation.input.right 是 session-scoped 列表槽，可在模型旁添加选择器；不要覆盖 conversation.input.model 的单占位。
- settings 支持 schema/base/user 分层和稀疏路径写入。
- Credentials describe/resolve/set 与现成 Remote 支持 Key-only 配置，不回显 secret。
- ctx.storage.domain.open(spec) 及 table.get/put/update 支持插件会话状态。
- agent/request 与 tools/execute 支持私有上下文接线；无需改变模型可见 web_search 参数。

### 9.2 空白新会话首消息前：需要小型宿主扩展

本机无 sessionId 时 left/right/model 槽都不渲染，SessionCreateRequest 没有通用插件草稿选择载荷。

完整实现“首条消息前选择搜索连接”，建议宿主增加：

1. 空白会话输入区 additive、session-maybe 控件槽。
2. 创建成功后、首条 prompt 前的 awaited draft handoff，插件有序保存草稿选择；失败可见且不越过失败提交。

这是拟新增契约，不是现有 API。不能靠 DOM 劫持、覆盖整个 composer 或全局变量规避。已有 Session 的入口可先实现，但未补齐该项时，不能宣称完整达到新会话 P0 UX。

## 10. 代码组织与实施顺序

~~~text
src/
├─ index.ts
├─ catalog.ts
├─ config.ts
├─ search/
│  ├─ service.ts
│  ├─ resolve-connection.ts
│  └─ freshness.ts
├─ adapters/
│  ├─ model/{anthropic,responses,chat}.ts
│  ├─ firecrawl.ts
│  ├─ exa.ts
│  ├─ tavily.ts
│  └─ tinyfish.ts
├─ dsh/
│  ├─ provider.ts
│  ├─ session-selection.ts
│  ├─ execution-context.ts
│  ├─ model-binding.ts
│  └─ remote.ts
├─ infrastructure/{http,diagnostics}.ts
└─ client/
   ├─ SearchConnectionSelector.tsx
   ├─ SearchSettings.tsx
   └─ ConnectionEditor.tsx
~~~

保持单包、静态注册、窄接口；不预建通用表单平台或动态插件 SDK。客户端元数据不得导入 Host 网络/凭据执行实现。

实施顺序：

1. Catalog、稀疏配置、Connection/Adapter 契约和 freshness。
2. 四个结构化适配器、固定/跟随模型绑定、三种模型搜索协议。
3. SessionSearchState、授权 Remote、快照和 Provider 接线。
4. 会话输入区选择器、Key-only 配置和顶层偏好 UI。
5. 空白会话槽与首条消息 handoff，完成完整 UX。
6. 旧配置导入：固定路由转固定连接；current-session 转跟随连接；旧解析回退不能悄悄转为跨服务失败兜底。

## 11. 验收标准

| 场景 | 预期 |
| --- | --- |
| 只配置 EXA_API_KEY | Exa 可选，settings 无四个完整后端块 |
| 加载完整 Catalog | 无网络探测、不物化默认配置 |
| A 会话 Firecrawl、B 会话 Tavily 并发 | 查询、凭据、结果不串用 |
| 固定模型连接下切换聊天模型 | 搜索模型与协议不变 |
| 跟随连接下切换模型和协议 | 后续有效请求跟随完整路由 |
| UI 有待生效模型，旧工具仍执行 | 不提前使用新模型路由 |
| 推理请求执行中切换搜索连接 | 旧工具不变，新 step 使用新选择 |
| realtime：Exa → Tavily → Exa | 顶层值不变，支持则映射，不支持则忽略 |
| Tinyfish + realtime | 不误发 recency_minutes，只调用 Search API |
| Firecrawl + realtime | 实际内联获取内容，不仅修改标记或返回旧 SERP 摘要 |
| Key 撤销或账号无权限 | 明确错误，不静默换服务 |
| 两窗口写同一 Session | stale revision 被拒绝并刷新 |
| 重启恢复 Session | 保留自己的连接，不被新默认覆盖 |
| 首条消息 handoff 保存失败 | 不以错误连接继续发送，可重试 |
| 原生工具和 PTC 多查询 | 快照一致、取消有效、结果契约一致 |
| 无快照/热加载进入执行中请求 | 明确失败，不读全局最后选择 |
| 重置设置或目录升级 | 不删 Key、不写全量默认、不混淆 ID |

真实供应商契约测试需用户配置测试 Key 并授权额度使用。本文没有执行认证或付费请求。

## 12. 证据与验证范围

### 官方 API

- [Firecrawl Search / OpenAPI](https://docs.firecrawl.dev/api-reference/endpoint/search.md)
- [Exa Search / OpenAPI](https://exa.ai/docs/reference/search.md)
- [Tavily Search / OpenAPI](https://docs.tavily.com/documentation/api-reference/endpoint/search.md)
- [Tinyfish Search 概览](https://docs.tinyfish.ai/search-api.md)
- [Tinyfish Search 参数与响应](https://docs.tinyfish.ai/search-api/reference.md)

参数结论来自本次实际读取的官方文档，不仅依赖搜索摘要。实现发布前仍需固定适配契约和 fixture；本次未验证账户权限、服务效果、价格或 SLA。

### 本机 DSH

以下相对路径统一以 /usr/lib/deepseek-harness/node_modules/@deepseek-ai/ 为前缀，证据来自安装产物声明与 JS：

- dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:202–234：列表型输入区槽与模型单槽。
- dsh-client-ui-conversation/lib/client.js:16178–16184：无 sessionId 时不渲染对应槽。
- dsh-api-session-controller/lib/types/types.d.ts:252–270：会话创建与模型选择参数。
- dsh-credentials/lib/types/index.d.ts:119–152：按操作解析、不回显的 describe、set/unset。
- dsh-api-settings-controller/lib/types/credentials.d.ts:23–49：现有凭据 Remote。
- dsh-settings/lib/types/index.d.ts:23–109,136–150：配置分层与稀疏路径操作。
- dsh-storage-domain/lib/types/index.d.ts:64–83；lib/types/domain.d.ts:1–8,36–77：存储域、同步读取和耐久写入。
- dsh-agent/lib/types/runtime-types.d.ts:313–341：pre-step/request 的 agent/turn/step，request 返回 LlmCallConfig。
- dsh-tools/lib/types/index.d.ts:38–49,197–221,261–291：执行 Hook 与上下文，不存在 exec.search 字段。
- dsh-web/lib/types/types.d.ts:14–51,98–103：Provider 请求、结果和取消契约。
- dsh-tool-web/lib/index.js:189–240,305–313：多查询聚合与结果投影。

本次仅新增设计文档，未修改插件实现、DSH 宿主、运行配置或用户凭据。
