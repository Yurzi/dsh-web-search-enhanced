# 开发指南

本文说明如何在本地开发、测试和发布插件。代码结构见[架构](architecture.md)，给编码代理的约定见 [AGENTS.md](../AGENTS.md)。

## 环境

- Node.js `^22.19.0 || >=24.0.0`（CI 在 22 和 24 上运行）。
- pnpm 11.7.0（见 `package.json` 的 `packageManager`）。
- DSH 相关包作为开发依赖固定在 `0.2.1-rc.2`，peer 依赖范围与 `engines.dsh` 一致（`>=0.2.1-rc.2 <0.3.0-0`，由 `verify:package` 检查）。
- 浏览器检查需要本机的 Chromium。

## 命令

```sh
pnpm install
pnpm run check
```

| 命令 | 作用 |
| --- | --- |
| `pnpm run check` | 依次运行 typecheck → build → test → verify:package，提交前必须通过 |
| `pnpm run typecheck` | `tsc --noEmit`，覆盖 src、tests 和 scripts |
| `pnpm run build` | 清理后生成类型声明，再用 tsdown 打包 `lib/index.js`（Host，ESM）和 `lib/client.js`（浏览器，DSH 模块格式） |
| `pnpm run test` | Vitest；`tests/client-bundle.spec.ts` 检查构建产物，`lib/client.js` 不存在时跳过，所以 `check` 先构建再测试 |
| `pnpm run verify:package` | 执行一次 `npm pack`，检查包内只有允许的文件、必需文件齐全、`engines.dsh` 与 peer 依赖一致、`locale/*.json` 含插件页的标题和简介 |
| `pnpm run check:ui` | 在无头 Chromium 中检查输入框按钮和设置页（桌面、390px 窄屏、深色） |

只运行部分测试：

```sh
pnpm exec vitest run tests/host.spec.ts tests/selections.spec.ts
```

### 浏览器检查

`check:ui` 用 [scripts/fixtures/ui.tsx](../scripts/fixtures/ui.tsx) 和 DSH 主题变量快照（`scripts/fixtures/dsh-theme.css`）渲染真实组件，Remote 由夹具模拟，不连接任何 DSH。它检查键盘操作、菜单位置、窄屏收起、写入冲突提示、稀疏写入和密钥只写入凭据等行为。

```sh
pnpm run check:ui
CHROMIUM=/usr/bin/chromium pnpm run check:ui        # 指定浏览器
pnpm run check:ui -- --screenshots .xdg/screenshots  # 同时保存截图
pnpm run check:ui -- --lang en                       # 用英文界面
```

截图文件为 `selector-{desktop,narrow,dark}.png`、`selector-not-ready.png`、`settings-{desktop,narrow,dark}.png` 和 `settings-editor.png`。更新 `docs/assets/` 中的截图时，把选择器截图裁到输入框和菜单区域，并压缩到 1600px 宽以内。

## 测试

测试优先使用真实的 DSH 组合（Cordis、WebRuntime、JSON storage-domain、Typert、Session Controller、工具运行时），只模拟网络和时钟，并且检查行为而不是实现细节。

| 文件 | 覆盖内容 |
| --- | --- |
| [adapters.spec.ts](../tests/adapters.spec.ts) | 各服务的请求与响应（按官方文档构造的样例）、免密钥路由、经 `executeSearch` 的分派 |
| [transport.spec.ts](../tests/transport.spec.ts) | 有界 HTTP 传输（重定向、非 JSON、断流、取消）与 MCP 客户端（握手、无状态、SSE） |
| [model.spec.ts](../tests/model.spec.ts) | 三种模型协议的请求构造、响应解析与凭据读取 |
| [follow-model.spec.ts](../tests/follow-model.spec.ts) | 跟随会话模型的路由推导，以及使用哪个模型 |
| [selections.spec.ts](../tests/selections.spec.ts) | 会话选择的初始化、fork、比较并写入、配对记录和存储持久化 |
| [settings.spec.ts](../tests/settings.spec.ts) | 稀疏解析、参数规则、version 1 迁移，以及真实 profile 中的运行时修改与迁移 |
| [host.spec.ts](../tests/host.spec.ts) | 真实 DSH 组合中的 Remote、每步冻结、代码模式搜索、关闭搜索隐藏工具、取消与故障恢复 |
| [composition.spec.ts](../tests/composition.spec.ts) | 安装补丁叠加在 base profile 上的结果，与 dsh-web-fetch-enhanced 的组合 |
| [client-apply.spec.ts](../tests/client-apply.spec.ts) | 客户端注册的插槽、命令，以及设置变化后的重读 |
| [client-bundle.spec.ts](../tests/client-bundle.spec.ts) | 构建后的 `lib/client.js` 只依赖 DSH 平台模块，并注入 CSS |
| [client-command.spec.ts](../tests/client-command.spec.ts) | `/setup-search` 的选项、写入与错误提示 |
| [client-locales.spec.ts](../tests/client-locales.spec.ts) | zh / en 词典完整、占位符成对，插件页元数据齐全 |
| [client-selection.spec.ts](../tests/client-selection.spec.ts) | 客户端选择状态的读取合并、失效、写入与冲突 |
| [client-selector.spec.tsx](../tests/client-selector.spec.tsx) | 输入框按钮与菜单的显示和交互 |
| [client-settings-model.spec.ts](../tests/client-settings-model.spec.ts) | 稀疏写入操作和自定义连接表单 |
| [client-settings.spec.tsx](../tests/client-settings.spec.tsx) | 设置页的保存、访问方式切换、参数、恢复默认与只读状态 |

`client-harness.tsx` 和 `client-t.ts` 是客户端测试的辅助文件。

## 在真实 DSH 中测试

隔离测试通过后，再在运行中的 DSH 里验证一次：

```sh
pnpm run build
pnpm pack
dsh plugin --profile web remove dsh-web-search-enhanced   # 已安装时先卸载
dsh plugin --profile web add "$PWD/dsh-web-search-enhanced-0.1.9.tgz"
```

安装后刷新 Web 页面，然后检查：

- 输入框出现地球按钮，菜单列出连接，切换后新的请求使用新连接。
- 两个会话的选择互不影响；刷新页面、重启 DSH 后仍保留。
- 设置页的修改只写入差异，保存密钥不改动设置。
- `web_search` 和 `web_fetch` 都能工作，不报 `WEB_PROVIDER_AMBIGUOUS`（可用 `dsh --profile web --dump-config` 查看 `web` 条目）。

真实搜索会把查询发给第三方服务，并可能消耗额度；只用公开、不敏感的查询词。

## 发布

1. 在 `package.json` 中更新 `version`（Host 和客户端构建时从这里读取版本号）。
2. 在 [CHANGELOG.md](../CHANGELOG.md) 中把 `[Unreleased]` 的内容整理为新版本条目，写明日期和升级说明；行为变化同步到 [升级指南](upgrading.md)。
3. 运行 `pnpm run check` 和 `pnpm run check:ui`，并按上节在真实 DSH 中验证。
4. 提交后打标签 `vX.Y.Z` 并推送。标签触发 [publish 工作流](../.github/workflows/publish.yml)：检查标签与 `package.json` 版本一致，运行 `pnpm run check`，然后以 provenance 发布到 npm。

npm 包只包含 `lib/`、`locale/`、`icon.svg`、`cordis.patch.yml`、README、CHANGELOG 和 LICENSE；`docs/` 不随包发布，README 中的图片和链接在 GitHub 上显示。
