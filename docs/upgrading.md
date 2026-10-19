# 升级指南

本文说明如何升级到 **0.1.10**、升级后有哪些变化，以及如何回退。字段细节见[配置参考](configuration.md)。

## 版本对应

| 插件 | DSH | 设置格式 | 会话存储 |
| --- | --- | --- | --- |
| 0.1.9 – 0.1.10 | `>=0.2.1-rc.2 <0.3.0` | version 2 | `web_search_enhanced` v1，表 `selections`、`pairings` |
| 0.1.6 – 0.1.8 | `>=0.2.0-rc.2` | version 2 | `web_search_enhanced` v1，表 `selections` |
| 0.1.5 | `>=0.2.0-rc.1` | version 2 | 同上 |
| 0.1.4 | `>=0.1.7-rc.2` | version 2 | 同上 |
| 0.1.3 | `>=0.1.7-rc.1` | version 2 | 同上 |
| 0.1.0 – 0.1.2 | `>=0.1.5-rc.2` | version 2 | 同上 |
| 0.0.x | 0.1.x 预发布版 | version 1（单一路由） | — |

插件版本、设置格式版本和存储版本是三个独立的编号。设置格式只在结构不兼容时递增，0.1.10 沿用 version 2，不需要格式迁移。

## 升级到 0.1.10

从 0.1.8 及更早版本升级时，还要看下文 [0.1.9 的行为变化](#019-的行为变化)。

### 1. 先升级 DSH

0.1.9 起只支持 DSH 0.2.1-rc.2 及之后的 0.2.x。用 `dsh --version` 确认版本；版本不符时安装会被兼容性检查拒绝。

### 2. 重新安装插件

DSH 默认开启热更新（HMR），这时对已安装的插件再执行安装会被拒绝，需要先卸载再安装：

- Web 界面：在 **插件** 页卸载本插件，再安装 `dsh-web-search-enhanced`。
- 命令行：

  ```sh
  dsh plugin --profile web remove dsh-web-search-enhanced
  dsh plugin --profile web add dsh-web-search-enhanced@0.1.10
  ```

安装后刷新 Web 页面。设置、DSH 凭据中的密钥、各会话的连接与实时性都会保留。用 `link:` 安装本地目录的开发环境要重启 DSH：热更新替换插件代码，但不会重新读取链接包的安装补丁。

### 3. 检查一遍

1. 打开一个已有会话，确认搜索菜单中的选择没变。
2. 新建会话并提问，确认 `web_search` 正常；再让模型抓取一个网页，确认 `web_fetch` 正常。同时装了 dsh-web-fetch-enhanced 时，确认它放行的地址能抓取。
3. 打开插件设置页，顶部没有关于 provider 的提示。有提示时按提示修改；用过 DSH 自带的「网页搜索」设置页的，见下文[如果改过内置的网页搜索开关](#如果改过内置的网页搜索开关)。

## 0.1.10 的行为变化

### 不再改写 web 条目，与抓取插件可以同时使用

0.1.9 的安装补丁把 `web` 条目写成只有 `searchProvider: enhanced-search`。补丁会整体替换条目的配置，`fetchProvider: http` 随之丢失，`web_fetch` 落入自动选择，与 dsh-web-fetch-enhanced 等抓取插件同时安装时无法正常使用。

0.1.10 改为占用原生 DeepSeek 搜索的 provider ID `deepseek-official`：base profile 的 `web` 条目本来就选中它，安装补丁只停用 `web-search-deepseek` 并插入本插件条目，`web` 条目保持原样。dsh-web-fetch-enhanced 用的是同一种做法（占用 `http`）。

### 不再停用 web-deepseek-api

`web` 条目的两个选择都已固定，DeepSeek Search / Fetch API 的 provider 不会再造成歧义，只在用户显式选择时使用，所以安装补丁不再停用它。

### 新增 providerId 与设置页提示

Loader 配置新增 `providerId`（默认 `deepseek-official`），需要保留原生 DeepSeek 搜索时可改用其他 ID 共存，见[配置参考](configuration.md#provider-id-与原生搜索共存)。`web_search` 不经过本插件时，设置页顶部会说明原因和改法。

### 手写的 enhanced-search 需要删除

如果在 Profile 中手写过 `searchProvider: enhanced-search`，或设置了 `DSH_WEB_SEARCH_PROVIDER=enhanced-search`，升级后会报 `WEB_PROVIDER_CONFIGURED_MISSING`（设置页也会提示）。删除这条覆盖即可。

## 0.1.9 的行为变化

### 修复 web_fetch 报 WEB_PROVIDER_AMBIGUOUS

DSH 0.2.1 默认挂载 DeepSeek Search / Fetch API（`web-deepseek-api`），它在没有密钥时也报告可用，与本地 HTTP 抓取同时存在会让 `web_fetch` 无法自动选择。0.1.9 的安装补丁停用了这个条目，抓取恢复为唯一的本地 HTTP 实现；与 dsh-web-fetch-enhanced 一起安装时同样可用。需要 DeepSeek 搜索时，使用下面新增的 DeepSeek 连接。

### 新增 DeepSeek 搜索连接

新增 `builtin:deepseek`，调用 DeepSeek Search API。会话使用 DeepSeek 账号登录的模型时，直接用账号授权；其他会话读取 `DEEPSEEK_API_KEY` 凭据，与 DSH「模型」页共用。它没有免密钥方式，未登录也没有密钥时在菜单中显示为不可用。

### 搜索菜单显示不可用的连接

0.1.8 及更早版本的输入框菜单只列出可用的连接。0.1.9 会列出所有已启用的连接：缺少密钥或无法使用的连接注明原因，点击后打开插件设置页，而不是选中它；当前选中的连接不可用时，菜单顶部说明原因并提供设置入口。停用的连接仍不显示。`/setup-search` 只列出可用的连接。

### 窄输入栏只收起，不再隐藏

0.1.8 在输入栏放不下时会暂时隐藏搜索按钮。0.1.9 改为纯 CSS 的逐级收起：先隐藏实时性，再隐藏连接名，最窄时只保留 28px 的地球图标，不会消失。只有在设置中关闭搜索按钮（`showSelector: false`）时才隐藏，此时用 `/setup-search` 切换。

### 模型与连接的配对记录重新开始

「在某个模型下选过的连接成为该模型新会话的默认」这一功能，记录从文件 `$DSH_HOME/cache/web-search-enhanced/model-connections.json` 改存到 DSH 存储（`web_search_enhanced` 域的 `pairings` 表）。旧文件不再读取，可以删除。升级后各模型的配对从空开始：在某个模型下第一次选择连接之前，该模型的新会话使用默认连接。

### 跟随会话模型需要显式的 api

插件不再读取 DSH 内部的 adapter 和 pi-ai 模型目录，只使用公开的模型配置。因此 provider 配置（或模型自己的条目）必须写明 `api`；`baseURL` 和凭据引用缺省时使用 provider 声明的默认值。provider 写了明文 `apiKey`、设置了自定义 `headers`，或是 OAuth / 订阅登录且没有 `apiKeyEnv` 时不支持。DSH 自带的 DeepSeek 路由没有 `api` 字段，无法跟随，请改用 DeepSeek 连接。不支持时报 `WEB_SEARCH_FOLLOW_UNSUPPORTED` 并说明原因。完整规则见[配置参考](configuration.md#跟随会话模型)。

### 界面改用 DSH 原生组件

输入框按钮和菜单改为与模型选择器一致的样式；关闭搜索的选项改名为「不使用搜索」，所选连接不响应实时性时实时性选项不可用。设置页改用 DSH 的表单组件：请求参数修改后自动保存；添加自定义连接时 `custom:` 前缀固定，凭据引用按 ID 给出建议，并可顺便填入密钥；移除自定义连接和恢复默认设置都需要确认。文案统一使用「密钥」，中英文完整。安装后，插件页会显示插件的图标和简介，首次启用时有一次性的使用提示。

### 移除的编程接口

以下导出已删除，它们只服务于 0.0.x 的单一路由模式，安装后的插件从未使用：`createProvider`、`resolveConfig`、`EnhancedSearchProvider`、`readConfig`、`validateSettings`、`importLegacy`、`configVersion`、`CURRENT_CONFIG_VERSION`、`DEFAULT_PROVIDER_ID`、`SETTINGS_NAMESPACE`、`DEFAULT_API_KEY_ENV`、`DEFAULT_BASE_URL`、`DEFAULT_MODEL`。

## 如果改过内置的网页搜索开关

安装本插件后，DSH 自带的 **插件 → 内置插件配置 → 网页搜索** 页面不再显示（它依附的 `web-search-deepseek` 已被停用，本插件占用了它的 provider ID）。如果以前在那里打开过「启用新版 Web 搜索 API」，用户配置的 `web` 条目中会残留 `searchProvider: deepseek-search-api` 和 `fetchProvider: deepseek-fetch-api`：

- 0.1.9 停用了 `web-deepseek-api`，搜索和抓取报 `WEB_PROVIDER_CONFIGURED_MISSING`；
- 之后的版本保留 `web-deepseek-api`，搜索和抓取都由 DeepSeek Search / Fetch API 完成，不报错，但本插件不参与，输入框中选择的连接不生效。

用 `dsh --profile web --dump-config` 查看 `web` 条目，删除用户层中的 `searchProvider` 和 `fetchProvider` 即可恢复：搜索回到本插件，抓取回到 `http`（DSH 的本地 HTTP 抓取，或替换它的 dsh-web-fetch-enhanced）。

## 从 0.0.x 升级

0.0.x 的单一路由配置（`modelMode`、`protocol`、`baseURL`、`model`、`apiKeyEnv` 等）会在插件启动时自动迁移为 version 2：

| 旧配置 | 迁移结果 |
| --- | --- |
| `modelMode: configured` 或固定路由字段 | 新建固定模型连接 `custom:legacy`（未写的字段取 0.0.x 的默认值），并在没有其他默认时设为新会话默认 |
| `modelMode: current-session` | 没有其他默认时，新会话默认改为 `builtin:session-model` |
| `apiVersion`、`toolIdentifier`、`maxTokens`、`maxUses`、`chatSearchMode`、`searchContextSize` | 写入 `custom:legacy` 的 `options` |
| `apiKeyEnv` | 成为 `custom:legacy` 的凭据引用；未写时为 `WEB_SEARCH_ENHANCED_API` |
| `fallbackModel` | 丢弃，不再有隐式兜底 |
| 明文 `apiKey` | 先写入 DSH 凭据，再从配置中删除；同名凭据已有不同的值时迁移停止 |

已有的 `connections`、`freshness`、`defaultConnection` 等字段原样保留；配置里已有 `custom:legacy` 时迁移停止，请先改名。

迁移完成前，搜索报 `WEB_SEARCH_MIGRATION_REQUIRED`，普通对话不受影响，设置页也会提示等待升级。迁移失败的原因记录在宿主日志中，常见的是凭据冲突或凭据服务不可写；修正后重启插件，或修改一次设置，就会重试。

## 回退

回退到 0.1.9 不需要改动 DSH 或设置。先删除 Profile 中的 `providerId` 和共存用的覆盖（0.1.9 不认识 `providerId`），然后卸载 0.1.10、安装 0.1.9 并刷新页面。注意 0.1.9 会改写 `web` 条目，与抓取插件同时安装时 `web_fetch` 会再次出问题。

回退到 0.1.8 及更早版本需要同时回退 DSH 到 0.2.0-rc.2：这些版本的安装补丁没有停用 `web-deepseek-api`，在 DSH 0.2.1 上 `web_fetch` 会报 `WEB_PROVIDER_AMBIGUOUS`。

回退前：

- 删除设置中 `builtin:deepseek` 的覆盖项，以及 `adapter: deepseek` 的自定义连接。旧版本不认识它们，会把整份设置判为无效。
- 选择了 DeepSeek 连接的会话，回退后会报 `WEB_SEARCH_CONNECTION_INVALID`，需要重新选择。

然后卸载当前版本、安装旧版本并刷新页面。其余 version 2 设置和会话选择可以被 0.1.6 – 0.1.8 直接读取。旧版本不认识 `pairings` 表，打开存储时可能将其丢弃；再次升级后，配对记录会重新积累。
