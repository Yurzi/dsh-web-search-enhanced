# dsh-web-search-enhanced

为 DSH 原生 web_search 提供会话级搜索连接：对话模型与搜索连接独立选择，支持免 Key、个人 API Key、固定模型及跟随会话模型。

> 当前为 refactor/search-connections-v2 分支构建，尚未发布。版本号仍为 0.0.6；npm 上的同号版本不是此分支产物。基于 DSH 0.1.5-rc.2 契约验证。

## 开始使用

1. 安装本分支构建的插件包。安装补丁为新会话明确选择 **Exa（免 Key）**，不覆盖已有 Session 的选择。
2. 在已有会话输入区的“搜索连接”中切换服务，对话模型不随之变化。
3. 设置 → 搜索连接，可修改新会话默认、内容实时性和访问方式。自定义连接使用普通表单，JSON 仅用于高级选项。

| 连接 | 默认方式 | 个人 API 凭据引用 | 行为 |
| --- | --- | --- | --- |
| Exa | 免 Key / 官方 MCP | EXA_API_KEY | 无需登录，有公共限额 |
| Firecrawl | 免 Key / 官方 Search REST | FIRECRAWL_API_KEY | 受 IP 和公共额度限制 |
| Tavily | 个人 API Key | TAVILY_API_KEY | 缺 Key 时不可执行 |
| Tinyfish | 个人 API Key | TINYFISH_API_KEY | Search 免费不等于匿名 |
| 跟随会话模型 | 当前 Session 的模型连接 | provider 的 apiKeyEnv | 不重复保存模型或 Key |

Exa / Firecrawl 的“免 Key / 个人 API Key”是**显式选择**。保存 Key 不会切换访问方式，限流或失败也不会偷偷换 Key 或服务。

- Exa 免 Key 调用 https://mcp.exa.ai/mcp 。
- Firecrawl 两种模式均调用 https://api.firecrawl.dev/v2/search ，匿名模式不发送 Authorization。
- 本轮 Exa 真实匿名查询成功；Firecrawl 从当前出口 IP 返回 403、拒绝匿名访问。插件给出提示，不绕过上游限制。
- “已配置 / 免 Key”表示本地条件满足，不代表权限、额度或网络健康验证。打开设置不探测供应商。

## 界面预览

实际 React 组件在隔离 Chromium 中渲染，**不是当前 DSH GUI 已安装或挂载的证明**。

![桌面设置预览](docs/assets/settings-desktop.png)

[深色预览](docs/assets/settings-dark.png) · [窄屏预览](docs/assets/settings-mobile.png)

## 内容实时性

顶层偏好在切换连接后保留，按请求冻结。它指内容缓存年龄，不是文章发布日期。

| 模式 | Firecrawl（两种访问方式） | Exa 个人 API Key | Exa 免 Key / Tavily / Tinyfish / 模型 |
| --- | --- | --- | --- |
| 自动 | 默认 Search | 默认内容策略 | 默认行为 |
| 优先新鲜 | 内联正文 maxAge=86400000 ms | contents.maxAgeHours=24 | 不支持时忽略 |
| 优先实时 | 内联正文 maxAge=0 | contents.maxAgeHours=0 | 不伪造实时参数 |

内联抓取可能增加延迟和额度消耗，参数不保证网页可抓取或真正实时。私有诊断记录 default/applied/ignored/partial，不扩展宿主结果或 Session 事件。

Exa 免 Key 首期仅支持 query 和数量，高级 options 需切换个人 API Key。Firecrawl 两种模式共用受限 options。

## 跟随会话模型

使用当前工具调用所属 exec.agent.session.requestHeader().config 中的完整 provider/model；只有尚无请求头才使用同一 agent options，不混拼字段。

从 llm-pi-ai.providers[provider] 解析 api、baseURL、apiKeyEnv。内置目录缺省地址/协议可由只读 adapter 目录补齐，显式配置不依赖兼容入口。支持 Anthropic Messages、OpenAI Responses、OpenAI Chat Completions。

首期要求显式 apiKeyEnv，统一通过 Credentials 解析；不重建 OAuth/订阅/scoped credential records，不透传自定义 headers。当前 rc.2 不支持 model 级 endpoint/API/凭据覆盖，插件不虚构这些字段。协议兼容不保证模型支持服务端搜索。

## 凭据与自定义连接

所有 Key 通过 DSH Credentials 保存和解析，不写入 settings、日志或快照。设置只保存引用与稀疏差异，重置不删除 Key。

固定模型表单包含名称、模型 ID、协议、地址、凭据引用。自定义服务使用 custom: 开头的 ID，新地址需显式信任确认。高级 JSON 对应配置示例：

~~~yaml
web-search-enhanced:
  version: 2
  defaultConnection: builtin:exa
  connections:
    builtin:exa:
      access: api-key
    custom:search-model:
      kind: model
      label: 专用搜索模型
      trustedEndpoint: true
      binding:
        mode: fixed
        protocol: openai-responses
        model: YOUR_SEARCH_CAPABLE_MODEL
        baseURL: https://api.openai.com/v1
        credentialRef: SEARCH_MODEL_API_KEY
~~~

固定模型 options：apiVersion、toolIdentifier、maxTokens、maxUses、chatSearchMode、searchContextSize。跟随连接的 optionsByProtocol 按协议分组，不跨协议复用标识。

结构化 options：Firecrawl country/location/safe；Exa type（auto/fast/instant，仅个人 Key）；Tavily search_depth/topic；Tinyfish location/language/purpose/domain_type。没有任意 headers/body 透传。

## 旧配置与错误恢复

设置页显式导入旧配置：configured → custom:legacy，current-session → 跟随会话模型。fallbackModel 不再执行，明文 apiKey 必须先移入 Credentials。导入不覆盖已有 Session 选择。

旧的笼统“本请求未能冻结会话搜索状态”已拆分：

- **存储暂不可用**：等待 Cordis storage-domain 激活；打开失败后可重试，不终身缓存拒绝。恢复后同一 step 可重建失败快照。
- **旧配置需要迁移**：到设置中导入，而不是提示所有连接不可用。
- **配置解析失败**：修正设置后发起新模型请求。
- **Firecrawl 拒绝匿名访问**：显式切换个人 API Key，或手动选择其他连接。

必须使用 DSH Storage Domain 持久后端，不悄悄退化为 localStorage/内存。搜索配置错误不阻断普通聊天。

## 边界

- 已有 Session 使用官方 conversation.input.right 追加槽，无 DOM 劫持或 composer 替换。
- 空白会话首消息前的独立选择器仍需宿主接入，当前由新会话默认处理。
- fork 继承父会话当前选择，之后独立；不重建历史 fork 边界。耐久删除通知缺失时保留孤立记录，不把 session/disposed 当删除。
- 保持原生 web_search 参数/结果及访问控制，原生/PTC 两条路径均有集成测试。

## 开发验证

~~~sh
pnpm install --frozen-lockfile
pnpm run check
~~~

本环境 pnpm run 启动器有数据库错误时，已安装工具可等价执行：

~~~sh
./node_modules/.bin/tsc -p tsconfig.json --noEmit
./node_modules/.bin/vitest run
node scripts/clean.mjs
./node_modules/.bin/tsc -p tsconfig.build.json
./node_modules/.bin/tsdown --config tsdown.config.ts
node scripts/verify-package.mjs
~~~

构建后运行 node scripts/preview-ui.mjs（可加 --dark）生成隔离组件预览 HTML，不启动另一个 DSH 服务。

[验证记录](docs/v2-implementation.zh-CN.md) · [架构设计](docs/design-v2.converged.zh-CN.md) · [MIT](LICENSE)
