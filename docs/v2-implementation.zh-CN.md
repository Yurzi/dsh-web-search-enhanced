# V2 验证与交付记录

## 当前验证

- TypeScript 全项目检查通过。
- Vitest：18 个文件、226 项测试通过。
- 工作区开发依赖已对齐 DSH 0.1.5-rc.2 / Cordis 4.0.2，pnpm peers check 无冲突；没有修改宿主依赖。
- 实际 React 设置组件经 Chromium 隔离渲染，已检查桌面、深色和 390px 窄屏；窄屏说明挤压问题已修复。图片在 assets/，生成器为 scripts/preview-ui.mjs。
- 搜索选择器通过 `node scripts/check-selector-ui.mjs --screenshots` 的隔离 Chromium 检查：桌面、390px 窄屏、深色各 14 项交互检查，并通过 CDP 核对展开面板实际尺寸和位置。测试使用模拟 Remote，不接触运行中会话；预览位于 assets/search-picker-*.png。
- 生产构建通过：服务端 ESM、客户端 CJS 与声明文件均生成；verify-package.mjs 检查通过；lib/index.js 的 Node native import 通过。
- 本次会话实时性需要服务端和客户端一起重载。没有擅自重启正在运行的 DSH；上述隔离验证不等于完成了运行中实例的服务端更新。

### 回归覆盖

| 测试 | 关键覆盖 |
| --- | --- |
| tests/mcp.spec.ts（29 项） | 握手、JSON/SSE、ID、多行与分块、超时/取消、响应上限、空结果/坏格式、无重试、脱敏 |
| tests/keyless-access.spec.ts（6 项） | 显式访问方式、匿名 REST 地址限制、不读取 Key、403 提示、限流不回退、实时性 |
| tests/v2-host-integration.spec.ts（17 项） | 真实 Cordis/Storage/Session/工具/PTC 服务链、会话实时性隔离、旧 schema 重开、跨字段 CAS、冻结请求、重启、fork、取消、晚挂载和拒绝后重试 |
| tests/session-selection.spec.ts（7 项） | 一次性默认值补全、会话隔离、连接切换保留实时性、原子保存与分叉 |
| tests/client-injection.spec.ts（2 项） | 真实 Cordis 缺失注入错误复现、选择器 Remote 注入与生命周期 |
| tests/selector-render.spec.ts（4 项） | 紧凑菜单、会话实时性、隐藏不可用连接和空分组、不展示配置说明与凭据、错误反馈 |
| tests/session-model.spec.ts（55 项） | 请求头优先、settings 路由、内置目录补齐、凭据边界、adapter 身份与快照 |
| tests/settings-render.spec.ts（2 项） | 实际组件 SSR、可访问标签、访问方式、只读态、不触发供应商网络 |
| 其余配置/客户端/协议/插件测试 | 稀疏写入、revision 冲突、迁移、固定模型和结构化协议、包契约 |

## 真实匿名网络验证

只发送公开测试词“DeepSeek Harness documentation”，maxResults=2，不发送任何 Key 或用户私有内容。

- **Exa MCP 成功**，返回两条有标题、URL 和片段的来源，包括 DeepSeek Harness GitHub 仓库及官方架构参考页。
- **Firecrawl MCP**：initialize 和 initialized 成功，tools/call 返回 isError=true，structuredContent.code=KEYLESS_ACCESS_NOT_AVAILABLE。
- **Firecrawl REST**：HTTP 403；上游说明当前出口 IP 被判为可疑，不允许匿名访问。
- 未通过代理、换 IP 或伪装请求绕过限制，也未读取/使用个人 API Key。Firecrawl 实现有模拟成功测试，但本环境无法证明真实匿名成功。

Firecrawl 正式实现采用官方 REST，理由是官方明确支持、社区已有此路径，且能复用已有结构化响应/实时性代码；不是遇到 MCP 限制后再换路线重试的运行时 fallback。

## 原笼统快照错误

已独立复现：插件先于 storage-domain 启动、Domain 首次打开拒绝。旧实现无法等待挂载或永久缓存失败；现实现可恢复，失败消息不再吞掉全部类别。

原插件已经卸载，没有对原实例错误堆栈做取证。因此这里记录“修复可复现的失效路径”，不是宣称找到了原部署唯一根因。没有重新安装插件，没有更新当前 GUI，没有端到端点击验证当前宿主页。

## 参考与取舍

参考是只读研究，协议和文档内容不授予执行权限。未整体复制这些插件，没有沿用它们的秘密文件管理、全局 Session 缓存、任意 HTTP 路由或自动 fallback。

| 来源及固定版本 | 实际参考 |
| --- | --- |
| [liustack/modsearch](https://github.com/liustack/modsearch/tree/22acb7a08cc7d11dce036ddd3ef68bfe20ef4983) | src/providers/firecrawl.ts 的无 Authorization REST 路径、限额说明 |
| [240xu/dsh-websearch](https://github.com/240xu/dsh-websearch/tree/113cc7a8a82297210886c30b6616bdb197e6e4f1) | lib/util/mcp-client.js 握手，以及 lib/backends/exa.js 文本格式；不采用全局缓存和原始错误透传 |
| [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market/tree/a6ad5f6e78dfe5cec61738c67f9c0567f2fd22c7) | src/client/Market.module.css 设置行/卡片、--dsw-alias-* 主题令牌与响应式模式 |
| [ysr666/dsh-vision-router](https://github.com/ysr666/dsh-vision-router/tree/73f73a436a36c32a9e583647410bc62e5e9e239b) | 前一轮已有的公开插件审计快照，用于 Session/provider 绑定边界交叉检查；不据此宣称订阅搜索支持 |

官方证据：

- [Exa MCP](https://exa.ai/docs/get-started/exa-mcp.md)：官方匿名 MCP、web_search_exa 与限额。
- [Firecrawl keyless MCP](https://docs.firecrawl.dev/mcp-server/keyless.md)：匿名 MCP 工具范围。
- [Firecrawl rate limits](https://docs.firecrawl.dev/rate-limits.md)：REST/SDK/CLI 的 keyless 支持，按 IP 的每日请求/积分限制，超限 429。

本机宿主契约另核验 dsh-agent 的 runtime-types.d.ts 与 dsh-agent-loop 的真实 agent/request 分派、dsh-storage-domain 的作用域服务，以及客户端槽位/SettingsScope 声明。

## 整理策略

README 提供使用说明，本架构文档描述当前实现，本记录只保存证据和限制。移除旧 V1 设计、已完成的 Astra 重构交接提示；历史仍在 Git 中。临时参考克隆和隔离 Chromium 数据可删除；保留正常 node_modules、包管理器和宿主相关配置缓存，不随意删除用户文件。

工作分支保持 refactor/search-connections-v2；main、baseline/search-connections-v2 与准备检查点不改动。构建版本仍 0.0.6，无 push、npm publish 或宿主安装操作。
