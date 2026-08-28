# dsh-web-search-enhanced

<strong>dsh-web-search-enhanced</strong> 是一个第三方 DeepSeek Harness <code>ctx.web</code> 搜索提供方。它保留模型看到的原生 <code>web_search</code> 工具与 <code>WebSearchResult</code> 输出，但允许 Web Profile 在三种上游协议之间切换：Anthropic Messages v1、OpenAI Responses API 和 OpenAI Chat Completions API。

## 功能

- 通过 <code>protocol</code> 切换三种非流式 HTTP 协议；
- 通过 <code>toolIdentifier</code> 覆盖上游内置搜索标识符；
- 通过 <code>maxTokens</code> 配置 <code>max_tokens</code> 或 <code>max_output_tokens</code>；
- 将三种响应中的来源与引用归一化为 DSH <code>WebSearchResult</code>；
- 在「设置 → 插件 → 插件配置」中提供可暂存、校验、保存、放弃和恢复 Profile 默认值的双语配置卡片；
- 拒绝携带凭据的 HTTP 重定向，并把取消、缺少凭据和上游错误映射为可路由的 <code>WebError</code> code。

## 安装

~~~bash
dsh plugin --profile web add /path/to/dsh-web-search-enhanced
~~~

安装后完整重启 <code>dsh web</code>。随包 <code>cordis.patch.yml</code> 会把 <code>ctx.web</code> 的 <code>searchProvider</code> 指向 <code>enhanced-search</code>，并禁用原生 <code>web-search-deepseek</code> provider；模型侧仍使用稳定的 <code>web_search</code> 工具。

## 配置

默认配置与 DSH 原生 DeepSeek 搜索兼容：

~~~yaml
- id: web-search-enhanced
  config:
    protocol: anthropic-messages
    baseURL: https://api.deepseek.com/anthropic/v1
    model: deepseek-v4-flash
    apiKeyEnv: DEEPSEEK_API_KEY
    maxTokens: 4096
~~~

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| <code>protocol</code> | <code>anthropic-messages</code> | <code>anthropic-messages</code>、<code>openai-responses</code> 或 <code>openai-chat-completions</code> |
| <code>toolIdentifier</code> | 按协议推导 | Anthropic/Responses 的 tool type；Chat 的 vendor-options 模式为自定义选项字段名 |
| <code>maxTokens</code> | <code>4096</code> | Anthropic/Chat 写入 <code>max_tokens</code>，Responses 写入 <code>max_output_tokens</code> |
| <code>baseURL</code> | DeepSeek Anthropic base | 按协议追加 <code>/messages</code>、<code>/responses</code> 或 <code>/chat/completions</code> |
| <code>model</code> | <code>deepseek-v4-flash</code> | 支持服务端网页搜索的模型 ID |
| <code>apiKeyEnv</code> | <code>DEEPSEEK_API_KEY</code> | Host 进程读取 API Key 的环境变量名 |
| <code>maxUses</code> | <code>5</code> | 仅 Anthropic Messages 的 <code>max_uses</code> |
| <code>chatSearchMode</code> | <code>search-model</code> | 官方专用搜索模型，或明确声明的 <code>vendor-options</code> 扩展 |
| <code>searchContextSize</code> | 上游默认 | OpenAI 兼容模式可选 <code>low</code>、<code>medium</code>、<code>high</code> |

<code>toolIdentifier</code> 留空时：Anthropic 使用 <code>web_search_20250305</code>；Responses 使用 <code>web_search</code>；Chat 的 vendor-options 模式使用 <code>web_search_options</code>。官方 Chat Completions 只在专用搜索模型上提供联网搜索，使用固定顶层 <code>web_search_options</code> 字段，而不是 Responses 风格的 <code>tools[]</code>；只有网关明确声明自定义字段时才选择 vendor-options。

配置页面不回显或写入 API Key。请通过启动环境提供 <code>apiKeyEnv</code> 指向的变量，或只在受保护的 Cordis composition 中使用 <code>apiKey</code> secret 字段。

## Standalone 限制

本插件与参考实现 <code>dsh-web-search-responses</code> 一样直接从 <code>ctx.web</code> 调用上游搜索模型，不新增 SessionEvent。DSH 当前持久化层只接受编译进 Host runtime catalog 的事件，外部插件仅做 TypeScript declaration merge 会导致会话恢复拒绝未知事件，因此本插件不会写入自定义事件。

原始 <code>web_search</code> query 仍由 DSH 的 <code>tool/call</code> 记录，但实际 endpoint、model 和协议请求 body 不能从当前 session log 完整重建。这是纯外部插件且不修改 Core 时无法消除的限制；需要严格辅助模型请求重放的部署不应启用本插件。

## 开发

~~~bash
pnpm install
pnpm run check
~~~

若系统 pnpm 状态目录不可写：

~~~bash
XDG_DATA_HOME=$PWD/.xdg/data XDG_CONFIG_HOME=$PWD/.xdg/config PNPM_HOME=$PWD/.pnpm-home pnpm install
~~~

详细需求分析、架构与风险见 [docs/design.zh-CN.md](docs/design.zh-CN.md)。
