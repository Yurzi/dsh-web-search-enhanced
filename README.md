# dsh-web-search-enhanced

[![npm version](https://img.shields.io/npm/v/dsh-web-search-enhanced.svg)](https://www.npmjs.com/package/dsh-web-search-enhanced)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-%3E%3D0.1.5--rc.2%20(RC%20Only)-blueviolet)](https://github.com/deepseek-ai/deepseek-harness)

**dsh-web-search-enhanced** 是为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 量身打造的增强型多协议联网搜索插件。

### 🌟 核心价值：直接使用模型供应商自身提供的联网搜索

传统智能体方案通常需要额外购买和配置第三方搜索引擎 API（如 Tavily、Bing Search API、Google CSE 等），不仅流程繁琐，还带来了额外的账单与调用延迟。

**dsh-web-search-enhanced** 让你可以**直接调用模型供应商（如 DeepSeek、Anthropic Claude、OpenAI 等）自身原生集成的服务端联网搜索功能**：
- 🚫 **告别额外依赖**：无需申请或维护独立的搜索引擎 API Key，直接复用你现有的大模型 API 凭据。
- 💰 **极致降低成本**：依托各大模型供应商原生提供的高性价比或免费搜索能力，大幅节约外部检索成本。
- 🎯 **深度原生优化**：充分利用厂商针对大模型特别调优的网页抓取、实时索引、正文解析与引用标注体系，检索质量更高、响应更迅速。
- 🔄 **保持原生体验**：模型端保持原生 `web_search` 工具签名与交互体验不变，无缝支持 Anthropic Messages、OpenAI Responses API 及 OpenAI Chat Completions 三大主流上游协议，并提供 Web 可视化配置面板。

---

## ✨ 核心特性

- ⚡ **直接利用模型厂商内置搜索**：原生调用各大模型供应商自身的服务端搜索（如 Anthropic `web_search_20250305`、OpenAI `web_search` / `web_search_options`、DeepSeek 服务端搜索等），免去一切第三方搜索引擎开销。
- 🌐 **多协议全面兼容**：无缝支持 **Anthropic Messages v1** (`/messages`)、**OpenAI Responses API** (`/responses`) 与 **OpenAI Chat Completions API** (`/chat/completions`) 三大协议，兼容各类官方端点与第三方 / 自建 AI 网关。
- 🔄 **灵活的双路由模式**：
  - **跟随当前会话 (`current-session`)**：自动继承当前会话正在使用的模型、提供方、调用协议与凭据，直接使用主模型供应商的搜索功能。
  - **固定搜索路由 (`configured`)**：为联网搜索单独指定专用搜索模型（如 `deepseek-flash`、`claude-3-7-sonnet`、`gpt-4o` 等），主对话与搜索模型分工明确。
  - **智能平滑兜底 (`fallbackModel`)**：当跟随模式遇到未知或未配置的模型路由时，自动降级至备用模型，确保搜索永不断流。
- 🖥️ **Web 控制台可视化配置**：深度集成 DSH Web 端「设置 → 插件 → Web Search Enhanced」，支持中英文双语、即时表单校验、草稿暂存、一键保存与重置。
- 🔒 **凭据安全与隐私保护**：通过 DSH 原生 Credentials 机制安全写入并保管 API Key，公开设置文档绝不保存明文密钥；请求强制阻断携带凭据的恶意 HTTP 重定向。
- 🎯 **开箱即用无感集成**：上游响应中的来源和引用会自动归一化为标准的 DSH `WebSearchResult`；主模型提示词和工作流无需任何改动。

---

## 📋 版本兼容与支持策略 (Compatibility & Requirements)

- **最低支持的 DSH 版本**：`>= 0.1.5-rc.2`
- **版本支持范围声明**：
  > ⚠️ **重要声明**：**本插件仅对 DeepSeek Harness 的 Release Candidate (RC) 版本进行官方维护与兼容性支持（最低版本要求为 0.1.5-rc.2）**。
  > 插件不提供对开发中的 Alpha / Beta / Nightly 构建版本的稳定性承诺与 API 兼容保证。在升级 DSH 或使用本插件时，请确保运行环境使用的是官方正式的 RC 发布版本。

---

## 📦 快速安装

插件已正式发布至 npmjs，使用 DSH CLI 即可一键安装到 `web` Profile：

```bash
# 安装插件至 web profile
dsh plugin --profile web add dsh-web-search-enhanced
```

安装完成后，重启 `dsh web` 服务即可生效：

```bash
# 启动或重启 DSH Web 服务
dsh web
```

> 💡 **提示**：安装后，插件随附的 `cordis.patch.yml` 会自动将搜索提供方指向 `enhanced-search`，并禁用原生默认搜索提供方。

---

## 🚀 快速上手与配置

### 方式一：Web 界面可视化配置（推荐）

> ⚡ **快捷命令**：在任何会话输入框中键入斜杠命令 `/search-config` 并回车，即可一键直达本插件设置面板！

1. 打开 DeepSeek Harness Web 界面（默认 `http://127.0.0.1:3080`）。
2. 点击左侧导航栏的 **设置 (Settings)** → **插件 (Plugins)**（或使用 `/search-config`）。
3. 找到 **Web Search Enhanced (插件配置)** 卡片。
4. 根据需要选择**模型路由**、**API 协议**、**接口地址 (Base URL)** 与 **模型标识 (Model ID)**。
5. 在 **API Key** 输入框中输入对应的模型供应商 API 密钥（输入后仅用于安全保存，保存成功后输入框自动清空，不留明文痕迹）。
6. 点击 **保存 (Save)** 即可实时生效，无需重启！

---

### 方式二：环境变量与配置文件配置

如果你使用 Headless 模式或希望通过环境配置初始化：

1. **设置 API Key 环境变量**（默认变量名为 `WEB_SEARCH_ENHANCED_API`）：
   ```bash
   export WEB_SEARCH_ENHANCED_API="sk-your-api-key-here"
   ```

2. **在 `cordis.yml` 中声明配置**（可选）：
   ```yaml
   - id: web-search-enhanced
     name: dsh-web-search-enhanced
     config:
       modelMode: configured
       protocol: anthropic-messages
       baseURL: https://api.deepseek.com/anthropic/v1
       model: deepseek-flash
       apiKeyEnv: WEB_SEARCH_ENHANCED_API
       maxTokens: 4096
   ```

---

## 💡 常用场景配置示例

你可以直接参考以下常见场景的配置参数，轻松接入各厂商自身提供的原生搜索功能：

### 1. DeepSeek 官方搜索（默认推荐）
使用 DeepSeek 官方兼容 Anthropic 协议的服务端搜索，速度快且成本极低：
- **模型路由 (modelMode)**: `固定配置 (configured)`
- **API 协议 (protocol)**: `Anthropic Messages v1`
- **接口地址 (baseURL)**: `https://api.deepseek.com/anthropic/v1`
- **模型标识 (model)**: `deepseek-flash`
- **API Key**: 填入你的 DeepSeek API Key

---

### 2. Anthropic 官方 Claude 联网搜索
直接调用 Claude 官方 Messages API 原生内置的 `web_search` 服务端搜索能力：
- **模型路由 (modelMode)**: `固定配置 (configured)`
- **API 协议 (protocol)**: `Anthropic Messages v1`
- **接口地址 (baseURL)**: `https://api.anthropic.com/v1`
- **模型标识 (model)**: `claude-3-7-sonnet-20250219` 或 `claude-3-5-sonnet-20241022`
- **内部搜索标识符 (toolIdentifier)**: 留空（默认使用 `web_search_20250305`）
- **API Key**: 填入你的 Anthropic API Key

---

### 3. OpenAI Responses API
使用 OpenAI 官方 Responses API 内置的原生联网搜索工具：
- **模型路由 (modelMode)**: `固定配置 (configured)`
- **API 协议 (protocol)**: `OpenAI Responses API`
- **接口地址 (baseURL)**: `https://api.openai.com/v1`
- **模型标识 (model)**: `gpt-4o`
- **搜索上下文大小 (searchContextSize)**: `中 (medium)`（可选 `low` / `medium` / `high`）
- **API Key**: 填入你的 OpenAI API Key

---

### 4. OpenAI Chat Completions 专用搜索模型 / 兼容中转网关
使用 OpenAI 官方搜索模型（如 `gpt-4o-search`）或各类第三方兼容网关（如 OneAPI、NewAPI、OpenRouter 等）提供的原生搜索支持：
- **模型路由 (modelMode)**: `固定配置 (configured)`
- **API 协议 (protocol)**: `OpenAI Chat Completions API`
- **接口地址 (baseURL)**: `https://api.openai.com/v1`（或中转网关地址，如 `https://api.your-proxy.com/v1`）
- **模型标识 (model)**: 目标搜索模型标识（如 `gpt-4o-search`）
- **Chat 搜索能力 (chatSearchMode)**: `官方专用搜索模型 (search-model)`（若网关使用自定义字段可切换为 `vendor-options`）
- **API Key**: 填入网关或官方 API Key

---

### 5. 跟随当前会话模型（自动继承厂商搜索）
让搜索自动使用当前 Agent 会话正在对话的模型供应商与协议：
- **模型路由 (modelMode)**: `当前会话模型 (current-session)`
- **兜底搜索模型 (fallbackModel)**: `deepseek-flash`（当当前模型不支持搜索协议或未解析到凭据时自动平滑回退）
- **API 协议 / 接口地址 / API Key**: 自动跟随当前会话的 LLM 路由配置

---

## ⚙️ 详细配置参数表

| 参数名 | 对应 Web 界面 | 默认值 | 可选值 / 格式 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `modelMode` | 模型路由 | `configured` | `configured` (固定配置)<br>`current-session` (跟随当前会话) | 决定搜索使用固定的独立模型，还是跟随当前会话的模型与协议。 |
| `protocol` | API 协议 | `anthropic-messages` | `anthropic-messages`<br>`openai-responses`<br>`openai-chat-completions` | 固定路由或兜底路由使用的上游 HTTP 协议。 |
| `baseURL` | 接口基础地址 | `https://api.deepseek.com/anthropic/v1` | 绝对 HTTP(S) URL | 上游接口的基础 URL。若末尾未包含协议端点后缀，插件会自动补全。 |
| `model` | 模型标识 | `deepseek-flash` | 字符串 | 固定路由使用的模型 ID，或无会话模型时的默认模型。 |
| `fallbackModel` | 兜底搜索模型 | 留空（默认同 `model`） | 字符串 | 仅跟随模式：当无法解析当前会话路由时所采用的兜底模型。 |
| `apiKeyEnv` | API Key 环境变量 | `WEB_SEARCH_ENHANCED_API` | 环境变量名 | 读取 API Key 的凭据引用名称。 |
| `apiKey` | API Key | 无 | 字符串（密钥） | Web 设置界面提供的一次性保存输入框，安全存入 DSH 凭据中心后自动清空。 |
| `toolIdentifier` | 内部搜索标识符 | 依协议自动推导 | 字符串 | 上游搜索工具/选项字段名。留空时自动适配官方默认名称。 |
| `maxTokens` | 最大输出 Token | `4096` | 正整数 | 单次搜索请求的最大输出 Token 数。 |
| `maxUses` | 最大搜索次数 | `5` | 正整数 | 仅 Anthropic 协议：单次请求允许服务端调用的最大搜索次数。 |
| `apiVersion` | Anthropic API 版本 | `2023-06-01` | 字符串 | 仅 Anthropic 协议：写入 `anthropic-version` 请求头的版本标识。 |
| `chatSearchMode` | Chat 搜索能力 | `search-model` | `search-model`<br>`vendor-options` | 仅 Chat 协议：官方专用搜索模型模式，或第三方网关自定义选项字段模式。 |
| `searchContextSize` | 搜索上下文大小 | 上游默认 | `low` / `medium` / `high` | 仅 OpenAI 协议：搜索上下文预算大小。 |

---

## 🔒 凭据安全与隐私设计

1. **凭据安全隔离**：Web 设置卡片中的 API Key 输入框仅作为向 `ctx.remote.credentials.set()` 发送写入请求的临时通道。一旦保存成功，输入框立即清空，DSH 的普通 settings document 中**绝对不会存储明文密钥**。
2. **防凭据泄漏机制**：所有向上游发起的请求均设置 `redirect: 'error'`。若上游服务发生 HTTP 重定向，请求会立即终止，严防 `Authorization` 或 `x-api-key` 被第三方捕获。
3. **URL 规范校验**：接口地址 (`baseURL`) 严格禁止包含用户名、密码、Query 参数或 Hash 锚点，杜绝敏感信息通过 URL 泄漏。

---

## ❓ 常见问题 (FAQ)

<details>
<summary><strong>Q: 为什么推荐直接使用模型供应商的内置搜索，而不是配置第三方搜索引擎？</strong></summary>

**A**: 
1. **省心省钱**：直接使用已有的大模型 API 凭据，无需单独注册、付费订阅第三方搜索服务（如 Tavily、Bing API 等）；
2. **质量与整合度高**：大模型供应商（如 Anthropic、OpenAI、DeepSeek）针对模型理解对抓取内容和上下文预算进行了专门优化；
3. **低延迟**：检索与正文提取由模型服务端直接完成，避免了客户端多次网络往返。
</details>

<details>
<summary><strong>Q: 安装插件后，模型会知道底层搜索协议改变了吗？</strong></summary>

**A**: 不会。DSH 内部采用分层架构，模型端看到的依然是原生的 `web_search` 工具，参数与返回值结构完全保持一致。插件仅在后台将搜索请求代理至你配置的上游协议，并把来源与引用归一化为 DSH 标准的 `WebSearchResult`。
</details>

<details>
<summary><strong>Q: 搜索时提示 <code>WEB_PROVIDER_CREDENTIAL_MISSING</code> 怎么办？</strong></summary>

**A**: 表示未找到有效的 API Key。请在 Web 界面「设置 → 插件 → Web Search Enhanced」卡片中输入 API Key 并点击保存，或者在启动 DSH 前配置环境变量（如 `export WEB_SEARCH_ENHANCED_API="sk-..."`）。
</details>

<details>
<summary><strong>Q: 跟随模式 (current-session) 在什么情况下会触发兜底？</strong></summary>

**A**: 当出现以下情况时会自动使用 `fallbackModel` 兜底：
- 当前 Agent 尚未选择具体模型；
- 当前模型的 Provider 未配置接口地址或协议不匹配；
- 获取当前路由的 ModelInfo 失败。
</details>

<details>
<summary><strong>Q: 如何卸载插件或还原到原生搜索？</strong></summary>

**A**: 运行以下命令从 Profile 中移除插件并重启 DSH：
```bash
dsh plugin --profile web remove dsh-web-search-enhanced
```
</details>

---

## 🛠️ 本地开发与调试

如果你希望基于本项目进行二次开发或贡献代码：

```bash
# 克隆仓库并安装依赖
git clone https://github.com/your-username/dsh-web-search-enhanced.git
cd dsh-web-search-enhanced
pnpm install

# 运行全套检查（类型检查 + 单元测试 + 构建 + 打包契约验证）
pnpm run check

# 单独运行单元测试
npx vitest run
```

技术架构与详细设计文档请参阅 [docs/design.zh-CN.md](docs/design.zh-CN.md)。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。