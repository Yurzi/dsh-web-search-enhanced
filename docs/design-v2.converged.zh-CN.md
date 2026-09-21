# V2 架构与实现边界

本文描述当前实现，替代已过时的“尚未实现”设计提案。用户操作见 README；验证证据见 v2-implementation.zh-CN.md。

## 1. 配置、目录与凭据

- src/catalog.ts：稳定内置 ID、标签、官方 API 地址、凭据引用以及 keyless 能力。
- src/config.ts：稀疏覆盖和严格校验。内置结构化连接不可改 kind/adapter/endpoint；自定义地址需信任标记。
- Exa / Firecrawl 默认 access=keyless，可显式设置 api-key。自定义服务、Tavily、Tinyfish 不开放匿名捷径。
- Settings 只保存配置差异与凭据引用。Key 只由 DSH Credentials 管理，不进入快照或浏览器 settings。
- 安装补丁明确指定新会话默认 Exa；目录本身不按遍历顺序决定选择。

## 2. 会话与执行上下文

src/dsh/session-selection.ts 将 connectionId/freshness/revision 存入私有 Storage Domain，以完整 Session ID 隔离并提供乐观并发控制。fork 复制父会话当前值，之后独立；保存过的不可用选择不会偷偷改为另一连接。

src/dsh/bridge.ts 通过真实 agent/request waterfall 建立快照。工具签名保持原生兼容；实际 agent 只从 exec.agent 获得，通过私有 AsyncLocalStorage 传入 Web provider。模型工具参数、公共 WebSearchContext 和 Session 元数据中均没有可伪造的选会话字段。

成功快照按 agent + turn + step 冻结。中途修改设置、连接、实时性，仅影响下一请求。原生调用和 PTC 共用同一工具实现。

### 存储生命周期与恢复

- 懒打开由 Cordis storageDomain 注入作用域拥有；未完成的实际服务激活会被等待。
- 同一作用域首次打开 single-flight；拒绝后清除状态，下次可重试。
- 作用域退出清除 opener，并等待关闭已打开的 Domain。
- 存储暂不可用产生可恢复的失败快照，不阻止 next() 执行普通推理。服务恢复后，同一 step 的后续请求钩子可以替换该失败快照；已成功的快照不会被替换。
- 不在工具执行途中重读设置来修补失败快照，避免同一请求偷偷换路由。
- 错误分类使用固定安全消息，不回传后端路径、原始设置或异常 cause。

当前分别呈现 WEB_SEARCH_STORAGE_UNAVAILABLE、WEB_SEARCH_MIGRATION_REQUIRED、WEB_SEARCH_CONFIG_INVALID。由于原故障插件已经卸载，没有原实例的错误堆栈，不能宣称其中某一种就是原部署的唯一根因。

## 3. 搜索分派

src/search/service.ts 根据冻结连接分派，不做跨连接 fallback。

| 模式 | 传输 | 凭据 |
| --- | --- | --- |
| Exa 免 Key | 官方 Streamable HTTP MCP / web_search_exa | 不读取 Credentials |
| Firecrawl 免 Key | 官方 /v2/search REST | 不读取 Credentials，不发 Authorization |
| 四种结构化服务个人 Key | 各自官方 REST | 显式引用 → Credentials |
| 固定搜索模型 | 三种协议 adapter | 固定 binding 的引用 |
| 跟随会话模型 | 同上 | Session provider 的显式 apiKeyEnv |

MCP 模块是插件私有传输，当前生产路由只由 Exa 使用；它也包含受测的 Firecrawl MCP 格式解析，Firecrawl 正式路由仍固定为 REST，不把二者当作失败重试通道。

### MCP 边界

src/adapters/mcp.ts：每次操作独立 initialize → notifications/initialized → tools/call。无跨 Session 的 MCP 缓存，无隐藏重试。传输支持 JSON 和 SSE、多行 data、分块 UTF-8、逐事件/批次匹配 JSON-RPC ID；匹配结果后取消流，无需等待永不结束的 SSE EOF。

90 秒操作期限、2 MiB 响应上限、拒绝重定向；即使注入 fetcher/read 不响应取消，也会终止等待。错误不透出上游 body、parser 输入或 cause。源 URL 排除非 HTTP(S)、内嵌认证、控制字符和重复项，并限制字段长度。未知结果格式不得伪装为成功空结果。

Exa 文本的 Title/URL/Published Date/Text/Highlights 及结构化内容统一归一化为原生 WebSearchResult。Firecrawl 的 REST 正文和实时性复用 src/adapters/structured.ts，不重复实现。

### 认证与计费边界

access 是明确选择，不根据“发现有 Key”猜测。匿名限流/拒绝后不读取个人 Key，个人 Key 失败也不转匿名或另一服务。Firecrawl 匿名 401/403 被解释为 WEB_KEYLESS_UNAVAILABLE；HTTP 429 保留限流分类。

## 4. 模型绑定

src/dsh/session-model.ts 的优先级：

1. 实际 agent 的请求头中完整的 provider/model；没有请求头才读同一 agent options，不拼接不完整字段。
2. llm-pi-ai 设置中该 provider 的 api/baseURL/apiKeyEnv。
3. 仅 api/baseURL 缺省时，受形状检查的 adapter.config.profiles().get(provider).piProvider.getModels() 目录补齐，不覆盖显式配置。
4. 首期凭据必须是 apiKeyEnv → Credentials；不重建 scoped credential records、OAuth/订阅或环境认证猜测。

按 step 冻结设置，按 provider/model 缓存解析结果。adapter 身份替换会拒绝旧请求。当前 rc.2 的 model 配置不能覆盖路由字段，插件不假装支持。

## 5. 实时性

freshness=auto/fresh/realtime 为会话持久偏好，与连接共用 revision，在请求快照中固定。设置中的 freshness 只作为新会话默认值，切换连接保留实时性。Storage Domain 保持版本 1，schema 新增可选字段以兼容旧记录；首次读取时原子补入默认值，保留已有连接（包括 null）和 revision，之后不再跟随默认值变化。get 返回有效会话实时性，set 支持仅更新连接、仅更新实时性或同时更新，至少包含一个改动。

- Firecrawl：fresh=86400000 ms、realtime=0，放入内联 scrapeOptions.maxAge。
- Exa REST：fresh=24 h、realtime=0，放入 contents.maxAgeHours。
- Exa MCP、Tavily、Tinyfish、模型：不发送猜测参数，诊断 ignored。
- 参数只表达缓存/抓取偏好，不证明真实内容新鲜度。私有诊断有请求、能力、正文覆盖情况，freshnessVerified 恒为 false。

## 6. 前端

设置使用官方 settings.plugin.item 槽、SettingsScope 稀疏路径操作与宿主 Credentials remote。样式遵循官方 --dsw-alias-* 颜色/边框令牌和设置卡片结构，作用域限定为 v2s-*；不假称使用了宿主未公开的 React 卡片组件。

实际布局由受托 gemini-flash-latest 初步重设计，主代理补充显式访问方式、普通连接表单和窄屏修复。原生 HTML 表单有 label、错误/状态区域和禁用态；JSON 被折叠为高级选项。

会话选择器使用 conversation.input.right 追加槽；不替换输入组件、不猜测首消息提交顺序。Remote 挂载后通过独立的 remote.searchConnections 注入作用域注册，避免未声明依赖导致插槽崩溃。外观参考宿主 ModelSelect 的 28px 触发器、24px 圆角、20px 菜单圆角及主题令牌；使用原生 top-layer popover 避免被输入框裁剪。面板仅展示可用连接及当前会话实时性，隐藏不可用连接、空分组和冗余顶部标题，不展示配置/凭据/可用性详情，也不因此自动替换已保存的连接。支持键盘导航、Esc 和焦点恢复，保存提示不撑高输入区。空白会话尚无独立选择器，由安装补丁的新会话默认处理。

## 7. 有意保留的限制

- 不把 session/disposed 视为耐久删除；没有可靠删除事件时保留孤立记录。
- 不重建历史 fork 时刻的选择，不提供跨会话隐式代理。
- 不读取或写入用户自建密钥文件，不增加自定义 HTTP 路由，不修改 DSH 宿主。
- Keyless 不是无条件可用承诺，上游可以限流或按 IP 拒绝。
- UI 隔离渲染、真实 DSH 服务测试不等于已重新安装并验证当前运行 GUI。
