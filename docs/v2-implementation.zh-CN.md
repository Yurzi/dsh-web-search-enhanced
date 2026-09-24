# 0.1.3 开发与验证指南

本文件保留原路径以避免断链，内容改为可重复的开发、验证与交付方法。架构见[当前架构](design-v2.converged.zh-CN.md)，用户使用见[配置参考](configuration.zh-CN.md)，版本升级见[升级指南](migration.zh-CN.md)。测试存在、测试通过、供应商在线可用、运行实例完成部署是四种不同结论，不能互相替代。

## 环境与开发入口

- Node.js：`^22.19.0 || >=24.0.0`；pnpm：按 packageManager 使用 `11.7.0`。
- DSH：包要求 `>=0.1.7-rc.1`，源码以 0.1.7-rc.1 服务契约为基线。依赖声明与锁文件是构建依据，不修改宿主安装的依赖来让测试通过。
- 当前开发主线为 `main`，旧版代码线为 `legacy/v0.0.x`。包版本 `0.1.3` 与 settings schema 的 `version: 2` 不同。

在仓库根执行：

```sh
pnpm install --frozen-lockfile
pnpm run check
```

`check` 顺序为 typecheck → build → test → verify:package（先构建，确保 bundle 测试验证当前产物而非旧文件或跳过）。任一步失败都不应宣称整个检查完成。安装依赖或构建可能写 node_modules / lib；纯文档工作不必重复构建来制造“验证记录”。

## 检查层级

| 命令 | 验证什么 | 不验证什么 |
| --- | --- | --- |
| `pnpm run typecheck` | TypeScript 全项目静态契约 | 实际服务挂载或网络行为 |
| `pnpm run test` | Vitest 自动化回归 | 上游实时可用性 |
| `pnpm run build` | clean、声明 / TS 输出、服务端 ESM 与客户端 CJS bundle | 宿主已加载新 bundle |
| `pnpm run verify:package` | 实际 pack 解包，必需产物及 patch 元数据 | npm 发布成功或线上安装成功 |
| `node scripts/check-selector-ui.mjs` | 隔离 Chromium 中选择器交互和布局 | 运行中 DSH 会话 / Remote 的真实部署 |
| `node scripts/preview-ui.mjs` | 构建后生成设置组件静态 HTML | 交互、服务端或真实 GUI |

verify-package 会临时打包并检查 `lib/index.js`、`lib/client.js`、`lib/types/index.d.ts`、`cordis.patch.yml`，随后删除临时包与解包目录。它内部优先 pnpm pack，失败才尝试 npm pack，不等于发布 registry。

如果 pnpm 启动器自身异常，先记录实际错误、版本与 PATH；不能把环境故障归因于插件，也不能未经确认修改宿主依赖。需要诊断时可分步执行已安装的工具，但这不再是“一条 pnpm run check 成功”：

```sh
./node_modules/.bin/tsc -p tsconfig.json --noEmit
./node_modules/.bin/vitest run
node scripts/clean.mjs
./node_modules/.bin/tsc -p tsconfig.build.json
./node_modules/.bin/tsdown --config tsdown.config.ts
node scripts/verify-package.mjs
```

## 回归测试地图

以下描述源文件覆盖方向，不是未经执行的通过报告；测试数量应以本次 runner 输出为准。

| 测试文件 | 关键边界 |
| --- | --- |
| [v2-config.spec.ts](../tests/v2-config.spec.ts)、[settings.spec.ts](../tests/settings.spec.ts) | 稀疏合并、ID / endpoint / options 校验、迁移、宿主设置 |
| [session-selection.spec.ts](../tests/session-selection.spec.ts) | 会话隔离、CAS、持久化失败、一次性 freshness 补齐、fork |
| [v2-host-integration.spec.ts](../tests/v2-host-integration.spec.ts) | 实际 Cordis/Storage/Session/原生工具/PTC 服务链，模拟网络；冻结、授权、重开、取消、晚挂载与重试 |
| [session-model.spec.ts](../tests/session-model.spec.ts) | 请求头优先、目录补齐、协议 / 凭据限制、adapter 替换、快照 |
| [structured.spec.ts](../tests/structured.spec.ts) | 四种 REST 的合成 fixture、实时性映射、正文缺失、传输大小 / 超时 / 脱敏 |
| [mcp.spec.ts](../tests/mcp.spec.ts) | JSON/SSE、握手、ID、多行与分块、取消 / 超时、无重试、格式和错误 |
| [keyless-access.spec.ts](../tests/keyless-access.spec.ts) | 显式匿名 / 个人模式、官方地址限制、匿名不读 Key、拒绝不转付费 |
| [protocols.spec.ts](../tests/protocols.spec.ts)、[provider.spec.ts](../tests/provider.spec.ts) | 三种模型协议、固定 provider 兼容辅助接口 |
| [plugin.spec.ts](../tests/plugin.spec.ts)、[bundle.spec.ts](../tests/bundle.spec.ts)、[egress.spec.ts](../tests/egress.spec.ts) | 插件导出、bundle / patch 契约、fetchProvider 不受干扰、出站 transport |
| [v2-client.spec.ts](../tests/v2-client.spec.ts)、[client-settings.spec.ts](../tests/client-settings.spec.ts) | 当前与兼容设置辅助逻辑、稀疏写入、凭据独立操作 |
| [settings-render.spec.ts](../tests/settings-render.spec.ts)、[selector-render.spec.ts](../tests/selector-render.spec.ts) | SSR 结构、折叠态、紧凑选择器、不可用项与状态 |
| [client-injection.spec.ts](../tests/client-injection.spec.ts) | Remote 命名空间注入顺序和生命周期 |

修改某层时至少运行对应测试，并补负向用例。例如新增供应商不能只测成功响应，还需检查访问方式互斥、无付费回退、取消、限流、安全错误和设置冻结。修改 Remote 字段应一起更新服务端 schema、客户端调用与真实宿主测试，不能只让 SSR 通过。

## 浏览器与 UI 验证

```sh
node scripts/check-selector-ui.mjs
# 指定本机 Chromium 可执行文件：
CHROMIUM=/absolute/path/to/chromium node scripts/check-selector-ui.mjs
# 仅在明确需要更新仓库预览资产时：
node scripts/check-selector-ui.mjs --screenshots

# 先构建，再生成静态设置预览：
node scripts/preview-ui.mjs
node scripts/preview-ui.mjs --dark
```

选择器脚本启动隔离 Chromium 和临时 profile，以模拟 Remote 运行组件；不连接或修改已有 DSH 会话。默认检查桌面、390px 窄屏、深色模式。`--screenshots` 会写预览图片，文档任务若未获资产修改范围不应使用。脚本使用本地 headless 浏览器参数，包括 `--no-sandbox`；仅在可信隔离开发环境运行。

preview-ui 写 `.dsh-smoke-home/settings-preview.html`，不会启动第二个 DSH 服务。静态预览 / 截图仅供布局审阅，不能证明设置保存、服务端更新或用户机器的实际挂载。

设置预览与选择器浏览器检查共用 `scripts/fixtures/dsh-theme.css`，其中记录 DSH 官方主题变量快照及来源提交。运行时仍直接继承宿主主题，不打包该快照；对齐新版主题时同步更新此文件，避免手写预览配色掩盖深色模式或按钮对比度问题。

真实宿主验收需另外安装构建包，重载插件或重启 DSH 并刷新 Web 页，再检查：

- 官方设置槽和已有会话输入区出现组件，主题 / 窄屏 / 键盘导航正常。
- 设置保存是稀疏操作，凭据写入与配置写入分离；readonly、冲突与错误有反馈。
- 两个会话选择隔离，freshness 与连接共同 CAS，刷新和重启后保留。
- seeded fork 首次继承后独立；删除 / 禁用连接不会自动换路由。
- 原生和 PTC 调用均使用可信 agent 的冻结快照；普通聊天不因搜索错误阻断。
- web_fetch 仍由原 fetch provider 处理。

## 网络验证的权限与证据

自动测试中的合成结果不证明匿名供应商当前在线。需要 live smoke 时明确所选服务、访问方式、查询、费用风险和目标地址；仅使用允许外发的公开词。匿名用例应让凭据 resolver 一旦被调用就失败，确认不读 Key；个人 Key 用例须获授权，不把秘密写进命令行日志。

记录模式、脱敏请求参数、状态 / 错误分类和实际来源数量。收到 IP 限制、401/403、429 时如实记录，不代理换 IP 或伪装身份绕过，也不隐式换个人 Key。一次成功不证明长期可用，失败也不自动证明代码故障。实时性参数仅验证传出正确，不能据来源片段声称已验证真实内容新鲜度。

## 打包与发布

1. 对最终待发提交运行 check 和所需浏览器 / 网络验证，记录版本与退出状态。
2. 使用 `pnpm pack` 生成构建包；检查包版本、入口、声明、patch、README 与 docs 完整性。GitHub 自动 Source code archive 不是含 lib 的发行 tgz。
3. 用户可用 `dsh plugin --profile web add /absolute/path/to/dsh-web-search-enhanced-0.1.3.tgz` 安装 Release 构建附件。
4. Git 操作、远端分支调整、标签、Release 和 npm 发布分别需要授权与结果核验；不要把本地构建当作已发布。主线为 main，旧代码保留 legacy/v0.0.x，不需要把历史文档反复改成当前成功记录。
5. 标签触发发布流程后，单独确认 workflow 和 npm registry 的版本 / 包内容，再宣称 npm 可安装。

发布不意味着已更新正在运行的 GUI；部署需要前后端一起重载。不要为“验证”擅自重启用户会话或启动另一个服务器冒充原实例。

## 0.1.0 本轮验证摘要（2026-09-21）

以下为本版本发布准备阶段实际执行的检查，不沿用先前历史测试成功结论：

| 项目 | 本轮结果 / 范围 |
| --- | --- |
| 环境 | Node v26.9.0、pnpm 11.7.0、DSH 依赖 rc.2 |
| `pnpm install --frozen-lockfile && pnpm run check` | 退出 0；类型检查、18 个文件 / 239 项 Vitest 测试、构建、包契约检查通过 |
| `node scripts/check-selector-ui.mjs` | 退出 0；desktop、narrow（390px）、dark 各 14 项，共 42 项隔离 Chromium 检查通过 |
| 服务端入口 | `lib/index.js` 原生 Node import 通过 |
| 配置示例 | 配置指南 5 段 YAML 通过解析与构建版 `resolveSettings` 校验 |
| 供应商实时网络可用性 | 上述检查不提供此证明 |
| 运行中 GUI 安装 / 服务端重载 | 上述检查不提供此证明 |
| GitHub Release / npm 发布 | 须另核对实际发布结果，不从本地检查推导 |

后续代码或依赖变更应重新运行适当检查，不把此摘要视为永久保证。提交问题时附版本、命令、退出状态及最小脱敏复现；不要上传 Key、私有查询、完整凭据文件或含秘密的上游响应。
