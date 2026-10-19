# 架构

本文面向维护者，说明插件由哪些部分组成、一次搜索如何执行，以及扩展时改哪里。用户可见的规则见[配置参考](configuration.md)，开发流程见[开发指南](development.md)。

## 概览

插件分两半，打包为一个 DSH 插件包（bundle）：

- **Host 端**（`lib/index.js`，入口 [src/index.ts](../src/index.ts)）：Loader 条目 `web-search-enhanced`。它默认以原生 DeepSeek 搜索的 ID `deepseek-official` 向 DSH 的 `web` 服务注册搜索 provider（Loader 配置 `providerId` 可改），保存每个会话的选择，并提供 `searchConnections` Remote。
- **客户端**（`lib/client.js`，入口 [src/client/index.tsx](../src/client/index.tsx)）：输入框搜索按钮、`/setup-search`、插件设置页和首次启用提示。

base profile 的 `web.searchProvider` 本来就选中 `deepseek-official`，[cordis.patch.yml](../cordis.patch.yml) 只停用占用同一 ID 的原生条目，不改动 `web` 条目（见[安装补丁](#安装补丁)）。模型看到的仍是 DSH 原生的 `web_search` 工具，参数和结果结构不变。

## 模块

```text
src/
  index.ts              Loader 入口：Config schema、编辑校验、挂载迁移器与搜索运行时
  catalog.ts            内置服务的事实：地址、默认凭据、免密钥/账号能力、实时性、参数规则（Host 与客户端共用）
  remote-contract.ts    searchConnections Remote 的 zod schema、类型合并与客户端描述（共用）
  settings/
    types.ts            持久化的 version 2 设置结构（共用）
    version.ts          CURRENT_CONFIG_VERSION、旧字段列表、configVersion()（共用）
    options.ts          按目录规则校验服务参数，含免密钥限制（共用）
    resolve.ts          resolveSettings()：稀疏合并 + 严格校验 → ResolvedSettings
    legacy.ts           version 1 → 2 的纯迁移
    migrator.ts         运行中迁移设置文档（按 revision 比较并写入）
  search/
    errors.ts           searchError(code, message)、取消辅助
    http.ts             有界 HTTP 传输：拒绝重定向、2 MiB、90 秒
    mcp.ts              免密钥 MCP 客户端（Streamable HTTP，JSON 或 SSE）
    model.ts            模型搜索：三种协议的请求与响应解析
    sources.ts          把不可信的结果行规范化为 DSH 来源
    execute.ts          executeSearch()：从搜索目标到网络的唯一分派点
    adapters/           每个服务一个模块，加上 index.ts 与 types.ts
  host/
    runtime.ts          installSearch()：注册 provider、请求钩子、Remote
    snapshots.ts        每个 Agent 每个请求步骤冻结的搜索计划
    selections.ts       会话选择：初始化、比较并写入、fork 继承
    pairings.ts         模型 → 连接的配对记录
    storage.ts          storage-domain 定义与懒打开
    follow-model.ts     跟随会话模型：从公开的模型配置推导路由
    connections.ts      每个会话看到的连接列表与状态
    remote.ts           SearchConnectionsService（searchConnections Remote）
    restriction.ts      搜索关闭时对该 Agent 隐藏 web_search
  client/
    index.tsx           注册插槽、命令、词典和 Remote
    locales.ts          zh / en 词典（所有界面文字）
    selection.ts        每个会话共享的选择状态
    connections.ts      选择器与命令共用的展示逻辑
    command.ts          /setup-search
    ActivationPrompt.tsx  首次启用提示
    selector/           输入框搜索按钮与菜单（CSS Module）
    settings/           设置页各部分、表单模型、稀疏写入、provider 路由提示（CSS Module）
```

标为「共用」的文件同时被 Host 和客户端打包，不能依赖 Node 或浏览器特有的 API。

## 一次搜索的流程

```text
agent/request（每个模型请求步骤）
  └─ Snapshots.capture(agent, turn, step)
       ├─ SearchSessions.current(agent)  读取或初始化会话选择（storage-domain）
       └─ planFor(selection, settings)   → off | invalid | structured | model | follow | failed
web_search（原生调用或代码模式调用）
  └─ deepseek-official provider（本插件）.search(request, signal)
       ├─ ctx.agents.currentInitiator()  找到发起调用的 Agent
       ├─ snapshots.get(agent)           取该步冻结的计划
       ├─ targetOf(plan)                 off / invalid / 跟随失败 → 抛出带错误码的 WebError
       └─ executeSearch(target, request, deps, signal)
            ├─ structured + keyless  → adapter 的 REST 请求或 MCP 工具（官方地址，不带凭据）
            ├─ structured + 个人密钥 → DeepSeek 账号令牌或 credentialRef 指向的密钥 → adapter REST
            └─ model                 → 模型协议请求 → 解析引用来源
```

要点：

- **每步冻结**：计划在 `agent/request` 时捕获，以 Agent + turn + step 为键。同一步里的原生调用和代码模式调用使用同一个计划，期间修改选择、设置或模型配置都不影响它。捕获失败会记录为 `failed` 计划并照常调用 `next()`，普通对话继续；同一步重试时会重新捕获。
- **找到调用者**：provider 通过 `ctx.agents.currentInitiator()` 找到发起调用的 Agent，不从工具参数接收会话 ID。不在会话模型请求中的调用报 `WEB_SEARCH_CONTEXT_UNAVAILABLE`。
- **跟随会话模型**：`follow` 计划保存该步复制的路由信息；实际路由在搜索时按发起请求的模型推导（[src/host/follow-model.ts](../src/host/follow-model.ts)）。
- **密钥在搜索时读取**：计划只保存凭据引用，不保存密钥。
- **搜索关闭**：选择为 `null` 时，[restriction.ts](../src/host/restriction.ts) 通过 `tools.restrict({ deny: ['web_search'] })` 对该 Agent 隐藏工具；`agent/created` 时先应用一次，保证第一个请求就生效。
- **provider 的 `available()`** 恒为 `true`，只做本地判断；连接是否可用由会话选择决定。

## 搜索服务接口（adapter）

每个内置服务由两部分描述：

- [src/catalog.ts](../src/catalog.ts) 的 `ADAPTERS` 条目：不含秘密的事实，Host 用于校验与路由，客户端用于设置页。`OptionRule` 的 `keyless` 字段表示免密钥时拒绝该参数（`false`）或收窄枚举值（列表）。
- [src/search/adapters/](../src/search/adapters/index.ts) 中的 wire 模块，实现 [types.ts](../src/search/adapters/types.ts) 的 `Adapter`：

```ts
interface Adapter {
  request(input: SearchInput, endpoint: string, auth: Auth): HttpRequest
  parse(payload: unknown, input: SearchInput): WebSearchSource[]
  /** 目录标记为 keyless 时必须存在：'rest' 表示用同一个 request 以匿名方式访问官方地址 */
  readonly keyless?: 'rest' | McpRoute
}
```

`Auth` 是判别联合：`keyless`、`api-key`（带 `key`）、`account`（带 `token`）。`types.ts` 提供 `postJson`、`getJson`、`bearer`、`apiKeyHeader`、`count`、`rowsAt`、`envelope` 等辅助函数；`sources.ts` 的 `collect` 负责过滤地址、去重和长度限制。适配器只构造请求和解析响应，传输、超时、错误分类由 [execute.ts](../src/search/execute.ts) 和 [http.ts](../src/search/http.ts) 统一处理。

### 新增一个搜索服务

1. 在 `ADAPTERS` 中加一项：`label`、`endpoint`、`credentialRef`、`keyless`、`account`、`freshness`、`homepage`、`options`。条目的位置就是界面中的显示顺序，连接 ID 自动为 `builtin:<id>`。
2. 新建 `src/search/adapters/<id>.ts` 实现 `Adapter`；只有目录中 `keyless: true` 时才提供 `keyless` 路由。支持实时性时在 `request` 中映射 `input.freshness`。
3. 在 [adapters/index.ts](../src/search/adapters/index.ts) 的 `ADAPTER_WIRES` 中注册（类型要求每个 `AdapterId` 都有对应模块）。
4. 客户端：在 [src/client/settings/model.ts](../src/client/settings/model.ts) 的 `ADAPTER_OPTION_COPY` 中为每个参数指定词条，并在 [src/client/locales.ts](../src/client/locales.ts) 的 zh 与 en 中加入参数名、占位符和枚举值的文案。
5. 测试：在 [tests/adapters.spec.ts](../tests/adapters.spec.ts) 中用按官方文档构造的样例覆盖请求和响应；免密钥路由与目录一致、词典完整由现有测试检查。
6. 文档：更新[配置参考](configuration.md)的内置连接表和参数白名单、README 的连接一览，以及 [CHANGELOG](../CHANGELOG.md)。

## 设置与版本迁移

- [src/index.ts](../src/index.ts) 的 Loader `Config` 中每个字段都是 volatile，设置页修改后无需重新挂载。`internal/config` 钩子在 Loader 保存前校验编辑，非法值不会落盘。插件对 settings 服务声明 `auto: false`，设置页由客户端提供。
- [resolve.ts](../src/settings/resolve.ts) 把稀疏文档合并到目录上并严格校验（zod strict），错误信息带字段路径。它是纯函数，不读取凭据，也不做隐式选择。
- 设置格式版本 `CURRENT_CONFIG_VERSION = 2`（[version.ts](../src/settings/version.ts)）。`configVersion()` 规则：显式 `version` 优先；没有 `version` 时，含 0.0.x 旧字段为 1，否则为 2；比当前更新或不是正整数时拒绝。
- [legacy.ts](../src/settings/legacy.ts) 是纯迁移（1 → 2），[migrator.ts](../src/settings/migrator.ts) 在运行中执行：读取设置文档及其 revision，先把明文密钥写入凭据，再以该 revision 调用 `settings.replace`。并发编辑会产生新 revision 并触发下一轮；失败只在 revision 或凭据服务变化后重试，期间搜索报 `WEB_SEARCH_MIGRATION_REQUIRED`。
- 客户端 [sparse.ts](../src/client/settings/sparse.ts) 只写与继承层不同的路径，首次写入时补上 `version: 2`；文档未迁移或版本更新时，设置页只读。

将来需要 version 3 时：提升 `CURRENT_CONFIG_VERSION`；增加 2 → 3 的纯步骤并保留 1 → 2；Loader schema 继续接受迁移前的旧字段；为每个旧版本到当前版本、幂等、输入不变和并发写入补测试。凭据等外部副作用放在迁移器里，不放进纯函数。

## 存储

会话状态存放在 DSH storage-domain 中（[src/host/storage.ts](../src/host/storage.ts)），域名 `web_search_enhanced`，版本 1：

| 表 | 键 | 值 |
| --- | --- | --- |
| `selections` | 会话 ID | `{ connectionId: string \| null, revision: number, freshness? }`；`freshness` 缺失的旧记录在第一次读取时补上当前默认值 |
| `pairings` | `JSON.stringify([provider, model])` | `{ connectionId: string \| null }` |

- 域在第一次使用时通过当前挂载的 `storageDomain` 打开；facility 更换后重新打开，打开失败时下一次调用重试，并报 `WEB_SEARCH_STORAGE_UNAVAILABLE`。
- 同一会话的读取和修改在内存队列中依次执行，`revision` 用于比较并写入（compare-and-set）。`revision` 为 0 表示用户还没选过，会话继续跟随默认值（[selections.ts](../src/host/selections.ts)）。
- 选择连接时，按会话「下一次请求将使用的模型」（待生效的切换 → 上次请求的模型 → Agent 的路由）写入配对。

## searchConnections Remote

契约在 [src/remote-contract.ts](../src/remote-contract.ts)，实现在 [src/host/remote.ts](../src/host/remote.ts)。两端用同一组严格的 zod schema。

| 方法 | 请求 | 结果 |
| --- | --- | --- |
| `searchConnections/get` | `{ sessionId }` | `SelectionView` |
| `searchConnections/set` | `{ sessionId, connectionId?, freshness?, expectedRevision }`，至少包含 `connectionId` 或 `freshness`；`connectionId: null` 表示关闭搜索 | `SelectionView` |
| `searchConnections/provider` | `{}` | `{ providerId, envProvider }`：本插件注册的 provider ID，以及 `DSH_WEB_SEARCH_PROVIDER` 的值（未设置为 `null`） |

`SelectionView` 是 `{ selection: { connectionId, freshness, revision }, connections: ConnectionView[] }`。`ConnectionView` 包含 `id`、`label`、`kind`（`structured` / `model`）、`access`（`keyless` / `api-key` / `account`）、`status`（`ready` / `disabled` / `needs-credential` / `unsupported`）、`freshness`（该连接是否响应实时性），以及可选的 `credentialRef` 和英文 `detail`。状态只根据本地事实判断，不探测上游服务。

错误：

| 代码 | 时机 | 详情 |
| --- | --- | --- |
| `searchConnections/unavailable` | `set` 指定的连接不存在或已停用 | `{ connectionId }` |
| `searchConnections/conflict` | `expectedRevision` 与存储中的不一致 | `{}` |
| `gateway/bad-request` | 请求不符合 schema | zod issues |

`get` 和 `set` 声明 `@Remote({ resources: { session: addressedSession } })`：DSH 的 Remote 访问控制按请求指向的会话资源授权（owner 总是允许），通过后再由 Session Controller（`sessionController.resolveAgent`）解析出 Agent，解析失败时返回 Session Controller 的错误。`provider` 不涉及会话，按内置的 `global` 资源授权。客户端用 `useAccess('searchConnections/set')` 判断能否修改，不能时菜单只读。

## 客户端

客户端入口声明 `inject = ['connection', 'slots', 'locale', 'configForms', 'remote', 'remote.credentials']`，注册以下界面：

| 位置 | 内容 |
| --- | --- |
| `conversation.input.right`（`id: 'web-search'`，`order: 20`） | 输入框搜索按钮与菜单（[selector/](../src/client/selector/SearchSelector.tsx)）；不可用的连接行在有 `pluginNavigation` 时跳转设置页 |
| `plugins.bundle.config`（`key` 为包名） | 插件设置页（[settings/](../src/client/settings/SettingsPage.tsx)），只在设置表单可用时注册 |
| `plugins.bundle.activation` | 首次启用提示（[ActivationPrompt.tsx](../src/client/ActivationPrompt.tsx)） |
| `commandUi`（可选） | `/setup-search`（[command.ts](../src/client/command.ts)） |
| `pluginNavigation`（可选） | 菜单底部「管理搜索连接」跳转到设置页 |

**选择状态**：[selection.ts](../src/client/selection.ts) 的 `SearchSelections` 为每个会话维护一份可观察快照，输入框按钮和 `/setup-search` 共用。并发读取合并为一次；模型变化、设置文档更新、凭据更新或与 Host 的连接重建会使快照过期，正在显示的会话立即重读，其余在下次使用时读取。写入带上界面显示的 `revision`；被拒绝时提示原因并重读。

**设置页**：通过 `configForms` 读取设置的继承层与用户层，所有修改以稀疏路径操作写入，请求参数逐项自动保存；密钥只通过 `remote.credentials` 写入 DSH 凭据，从不进入设置。

**provider 路由提示**：[route.ts](../src/client/settings/route.ts) 按 `ctx.web` 的规则判断 `web_search` 是否经过本插件：先看 `configForms.get('web')` 的 `searchProvider`，没有时看 `DSH_WEB_SEARCH_PROVIDER`，都没有时为自动选择。`providerId` 不是设置字段，浏览器看不到，所以它和环境变量由 `searchConnections/provider` 提供。只在设置页显示时订阅 `web` 条目并读取 Host；设置文档更新或与 Host 的连接重建后重读，因为在 Profile 中修改 `providerId` 会让插件重新挂载。结果为 `this`、`auto`、`other`（附 provider ID）或 `unknown`（`web` 条目不对本客户端可见，或 Host 还没有回答）；`auto` 和 `other` 在页面顶部给出提示，`deepseek-search-api` 单独说明是内置「网页搜索」页面的开关留下的。

**样式与组件**：使用 `@deepseek-ai/dsh-client-ui-primitives` 的组件（菜单、开关、分段控件、输入框等），它是 DSH 外壳提供的平台模块，不打进插件包。样式写在 CSS Module 中，只用 DSH 的 `--dsw-*` 设计变量；构建时编译进 `lib/client.js`，每个样式表带 `data-plugin` / `data-plugin-css` 标记注入一次（[scripts/client-build.ts](../scripts/client-build.ts)）。输入栏变窄时，按钮按 container query 和 DSH 提供的 `--dsh-composer-model-text-display` 逐级收起，没有 JavaScript 测量。

**文案**：所有界面文字都在 [locales.ts](../src/client/locales.ts) 的 `webSearchEnhanced` 命名空间中，zh 为主、en 完整对应；Host 只返回状态码和英文诊断，由客户端本地化。插件页显示的名称和简介来自 `locale/zh.json`、`locale/en.json` 的 `meta`。

## 安装补丁

DSH 0.2.1 的 base profile 有四个 Web 相关条目：`web`（`searchProvider: deepseek-official`、`fetchProvider: http`）、`web-search-deepseek`、`web-deepseek-api` 和 `web-fetch-http`。本插件与 dsh-web-fetch-enhanced 采用同一种做法：占用 base 已经选中的 provider ID，只停用原来占用这个 ID 的原生条目。[cordis.patch.yml](../cordis.patch.yml) 做两件事：

1. 停用 `web-search-deepseek`（DeepSeek Messages 搜索）。它注册的也是 `deepseek-official`，同时挂载会报 `WEB_DUPLICATE_PROVIDER`。它的作用由 DeepSeek 连接和模型连接覆盖；停用后内置的「网页搜索」设置页也不再显示，那个页面的开关会改写用户层的 `web` 条目。
2. 插入 `web-search-enhanced` 条目，默认连接为 `builtin:exa`。

**不改 `web` 条目**：profile 补丁会**整体替换**目标条目的 `config`，不做深合并。0.1.9 及以前的补丁把 `web` 写成只有 `searchProvider: enhanced-search`，`fetchProvider: http` 随之丢失，`web_fetch` 落入自动选择：dsh-web-fetch-enhanced 的路由判断和设置页提示都失效，任何额外的抓取 provider 都会让它报 `WEB_PROVIDER_AMBIGUOUS`。占用 `deepseek-official` 后，base 的两个选择原样保留，其他插件、用户层的覆盖都能与本插件组合。

**providerId**：Loader 配置中唯一的普通（非 volatile）字段，默认 `deepseek-official`。Settings 不提供也不写入它，修改它会让 Loader 重新挂载插件并以新 ID 注册。需要保留原生 DeepSeek 搜索时，重新启用 `web-search-deepseek`，把 `providerId` 改为其他 ID，并在 `web` 条目中写明两个字段，见[配置参考](configuration.md#provider-id-与原生搜索共存)。

**不停用 `web-deepseek-api`**：两个选择都已固定，它的 `deepseek-search-api` 和 `deepseek-fetch-api` 只在用户显式选择时使用，不会造成歧义。它的抓取 provider 属于 `web_fetch`，停用它会让选择了它的用户抓取失败，这不是搜索插件该做的决定。

[tests/composition.spec.ts](../tests/composition.spec.ts) 用真实的补丁算法和 `WebRuntime` 验证这一组合：`web` 条目与 base 完全一致，与 dsh-web-fetch-enhanced 以两种顺序同时安装时搜索和抓取各自落到对应插件，用户层的显式选择仍然可用。
