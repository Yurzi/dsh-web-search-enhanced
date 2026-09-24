# 更新日志

记录 `dsh-web-search-enhanced` 的用户可见变化。历史条目描述对应版本，不代表当前行为。

## [Unreleased]

## [0.1.4] - 2026-09-24

### DSH 0.1.7-rc.2 兼容性

- 最低宿主版本提升至 `0.1.7-rc.2`；DSH peer 依赖下限、精确开发依赖、锁文件及预发布安装白名单同步对齐。
- 核对动态工具更新、DeepSeek Provider 拆包、模型选择校验、Schedule 与审批变更；插件不调用 selectModel，不依赖被移除的 Schedule API，无需修改搜索运行时代码。
- 跟随模型仍仅支持可解析的 API Key 路由，不因宿主支持官方账号而自动支持账号 / OAuth 搜索；固定连接及结构化搜索不受模型选择校验影响。
- 设置格式 version 2、会话 Storage Domain version 1 保持不变；完整边界见 [rc.2 影响评估](docs/upstream-0.1.7-rc.2-assessment.zh-CN.md)。

### 搜索选择器请求优化

- 移除每 2 秒常驻轮询；首次加载、模型实际变化、展开菜单及页面恢复可见/焦点时按需读取，关闭菜单和普通重渲染不请求。
- 增加按会话隔离的 30 秒客户端缓存与并发请求合并，最多保留 64 个空闲会话项；TTL 到期本身不会触发请求。
- 写入成功直接复用返回值；手动重试和写入冲突刷新绕过缓存，模型/配置失效发生在请求期间时合并补读，防止旧响应覆盖新状态。
- 插件配置变化及本插件保存凭据后使缓存失效；连接断开/重建与插件卸载清理缓存并隔离旧请求。
- 本阶段不增加服务端推送：其他窗口的修改在后续缓存过期的按需刷新时同步，不再保证两秒内自动同步；版本冲突保护保留。

## [0.1.3] - 2026-09-24

### 界面细节对齐

- 保留设置卡片、行内配置与会话搜索菜单布局，对齐 DSH 的中性色按钮、表单底色、细边框、状态标签和单色凭据图标。
- 搜索菜单采用官方紧凑间距、圆角、背景模糊和浮层阴影；实时性分段选项跟随宿主主题。
- 修复主按钮悬停时文字颜色被覆盖的问题，改善窄屏表单与操作按钮换行，并尊重减少动态效果偏好。
- 设置与选择器预览共用官方浅色／深色主题变量快照，更新界面截图。

### DSH 0.1.7-rc.1 适配

- 最低宿主版本提升至 `0.1.7-rc.1`，开发依赖固定到该版本；Cordis / Schemastery 对齐 volatile 配置能力。
- 服务端改用 Loader `Volatile<T>.get()` 与 `internal/config` 校验，SettingsForms 只负责 profile 投影与 CAS 保存；移除 installSection 和直接写 settings.yaml 的旧逻辑。
- 保留旧配置导入：跟随宿主 settings.yaml → profile 时序，先迁凭据再替换配置，失败保留旧值并可重试，不覆盖已有不同凭据。
- 客户端设置迁移至 ConfigForms 和 plugins.bundle.config，使用 hooks/回调注入与 whileServed 生命周期；修复保存拒绝仍显示成功的问题。
- 会话选择器使用类型化 modelSelection projection；跟随模型按公开目录中的实例 namespace/path 读取设置，不扫描废弃 session 事件。
- Typert strict codec 改惰性 create()；集成测试迁移 PtcRuntime.resolve/run，保留 native/PTC 请求快照与并发隔离。
- 更新真实 profile、交互、模型目录与发布包契约测试，配置示例改为 profile patch。

### 升级边界

- 配置格式仍为 version 2，搜索选择 Storage Domain 仍为 version 1；不迁移或重写宿主 Session 日志。
- 跟随模式仍有受限 adapter identity/catalog 兼容 shim，不自动扩大到 OAuth/订阅认证；无法证明绑定时拒绝搜索，可用固定连接。
- 本版本需重新加载服务端插件并刷新 Web 页面；不支持旧版 settingsScope/settings.plugin.item 宿主。

## [0.1.2] - 2026-09-22

### 新增与修复

- 新增 OpenAlex 与 Semantic Scholar 学术检索连接，支持摘要、作者、引用计数与开放获取链接。
- 修复 OpenAlex 个人 API Key 认证：使用 api_key 查询参数，免 Key 模式不发送凭据；支持配置 mailto 联系邮箱。
- 模型切换时，尚未手动修改选择的非 fork 会话（revision 为 0）动态更新搜索连接；客户端订阅模型选择变化。
- 内置及自定义连接的 Key、OpenAlex 邮箱和已有连接编辑统一在对应行下展开，避免共享凭据引用导致重复展开。
- 移除独立迁移脚本和手动导入入口，仅保留启动自动迁移；统一旧字段检测，验证转换结果后顺序写入凭据与设置，失败时保留旧配置并输出脱敏提示。
- 更新配置、升级指南及安装示例，补充认证、稀疏旧配置迁移与设置渲染回归测试。

### 升级注意

- 升级前自行备份 settings.yaml；重新加载插件或重启 DSH 后刷新 Web 页面。
- 不再提供 pnpm run migrate 命令。自动迁移失败时，检查宿主日志、旧配置和 Credentials 写权限后重启插件。
- 保存 Key 不会自动切换访问模式；个人 Key 仍需显式选择。

## [0.1.1] - 2026-09-21

### 新增与优化

- **模型与搜索连接智能记忆联动**：引入 `ModelPairingStore` 状态缓存机制（持久化于 `$DSH_HOME/cache/web-search-enhanced/model-connections.json`），实现不同对话模型与其最近一次选择的搜索连接自动绑定与恢复；新会话自动恢复该模型最近一次使用的搜索连接偏好，未记录模型平滑回退至全局默认配置。
- **自定义连接配置全面采用 DSH 原生 YAML 规范**：设置页自定义连接编辑器升级为 DSH 原生 YAML 块级缩进格式（替代原 JSON 格式），大幅提升阅读与手动编辑体验，并保持完全向后兼容。
- **配置自动迁移与静默自愈**：该版本提供命令行配置迁移脚本及启动时自动迁移；独立脚本在 0.1.2 中移除。
- **文档与应用市场体验优化**：优化 README 用户安装与上手指引，补充更友好的安装与使用说明及截图清单 `screenshots.json`。

## [0.1.0] - 2026-09-21 🎉

### 全新搜索连接架构

- 用会话级搜索连接取代旧全局模型配置；对话模型与搜索连接独立选择。
- 内置 Exa、Firecrawl、Tavily、Tinyfish，支持显式免 Key / 个人 API Key 模式；安装为新会话默认选择 Exa。
- 支持固定搜索模型及跟随会话模型，适配 Anthropic Messages、OpenAI Responses、OpenAI Chat Completions。
- 会话持久化连接与内容实时性偏好；请求使用冻结快照，fork 复制后独立，多标签页通过 revision 检测冲突。
- 重写设置页与紧凑搜索选择器，支持表单化自定义连接、深浅色主题和窄屏布局。
- 凭据通过 DSH Credentials 解析；设置仅保存引用与稀疏差异，自定义端点要求显式信任。
- 扩充传输、宿主集成、会话隔离和 UI 回归测试；重写 README、配置、迁移、架构与开发文档。
- 新增 Q 版 DeepSeek 鲸鱼娘搜索主题 Banner，并注明角色与参考作品归属。

### 升级注意

- 旧配置需在设置页显式导入；`configured` 映射至 `custom:legacy`，`current-session` 映射至跟随会话模型。明文 Key 先迁入 Credentials。
- 不再执行 `fallbackModel` 或自动切换 Key / 服务；移除旧模型请求审计事件及 `/search-config` 快捷命令。
- 跟随会话模型要求 provider 显式配置 `apiKeyEnv`；不重建 OAuth / 订阅凭据，不透传自定义 headers。
- Tavily / Tinyfish 未显式设置访问方式时使用免 Key；Tinyfish `research_paper` 需要个人 Key。
- 实时性是内容缓存年龄偏好，不是发布日期过滤，且仅部分适配器支持。
- 前后端契约同时更新：升级后重新加载插件或重启宿主，并刷新页面。
- 主开发线使用 `main`；旧 0.0.x 主线保留于 `legacy/v0.0.x`。

详见[升级指南](docs/migration.zh-CN.md)。

## [0.0.6] - 2026-09-11

### Changed
- **Sparse Settings Mutation & Bloat Prevention**: Redesigned client settings card (`SearchSettingsCard`) with differential analysis (`computeSettingsOperations`) against schema defaults and composition base. Default values matching the inherited baseline are omitted to prevent `$DSH_HOME/settings.yaml` from bloating.
- **Redundant Overrides Self-Healing & Pruning**: Existing redundant default keys in user settings are automatically pruned via `unset` operations on save or reset, restoring a clean configuration file for existing users.
- **Single Atomic Mutation Batching (`scope.mutate`)**: Replaced consecutive serial `scope.set` calls with a single atomic `scope.mutate(ops)` transaction, eliminating multiple filesystem locks and I/O thrashing during settings persistence.
- **Decoupled Credential Storage**: Saving an API key without modifying other configuration parameters executes credential writes exclusively, resulting in zero mutations written to `settings.yaml`.

### Removed
- **Scaffolding & Outdated Documentation**: Cleaned up obsolete template comparison and outdated alpha contract references from `docs/`.

## [0.0.5] - 2026-09-11

### Changed
- **DSH 0.1.5-rc.2 Exclusivity & Compatibility**: Upgraded engine requirement to `engines.dsh >= 0.1.5-rc.2` and all `@deepseek-ai/*` peerDependencies/devDependencies to `^0.1.5-rc.2`, dropping legacy support for `v0.1.2-rc.1`.
- **Default Model Upgrade**: Updated global `DEFAULT_MODEL` and profile patch fallback model from `deepseek-v4-flash` to `deepseek-flash` (DeepSeek-V41-Flash) to match upstream DSH 0.1.5 conventions.
- **Session Audit & Transparency (`recordRequest`)**: Implemented pre-dispatch request logging via `session.append('web/deepseek-search-llm-request')`, safely capturing resolved endpoints, protocol identifiers, API versions, and secret-free payloads for turn auditing and trajectory exports.
- **Client Action Command (`/search-config`)**: Added client-side `/search-config` action command leveraging DSH 0.1.5 `ActionSpec` (`kind: 'action'`) to provide instant one-click navigation directly to the Web Search Enhanced settings card without interrupting conversation flow.
- **Egress & Proxy Verification**: Expanded egress test suite to verify outbound request dispatching under proxy and custom fetcher environments.

## [0.0.4] - 2026-09-03

### Changed
- **DSH 0.1.2-rc.1 Minimum Requirement & Compatibility**: Updated `engines.dsh` to `>= 0.1.2-rc.1` and `peerDependencies` across all `@deepseek-ai/dsh-*` packages to `^0.1.2-rc.1`.
- **RC-Only Support Policy**: Formally documented in `README.md` that the plugin exclusively supports DSH Release Candidate (RC) versions with a minimum requirement of `>= 0.1.2-rc.1`, and does not support intermediate alpha/beta/nightly snapshots.
- **Anthropic Endpoint Normalization**: Aligned with upstream PR #3451 specifications; added automatic normalization for Anthropic Messages `baseURL` with or without trailing `/v1` (e.g., `https://api.anthropic.com` safely resolves to `/v1/messages`), preventing 404 errors on official Anthropic endpoints and compatible gateways.
- **Out-of-the-Box Credential Fallback**: Added automatic fallback to `DEEPSEEK_API_KEY` when `apiKeyEnv` remains at default `WEB_SEARCH_ENHANCED_API` and the target endpoint is DeepSeek, enabling seamless drop-in replacement of the native search provider without redundant credential re-entry.
- **Client Build Defines Alignment**: Updated `tsdown.config.ts` define configuration to supply the root `import.meta.env` object alongside `import.meta.env.MODE`, matching upstream preset conventions and preventing property-probe runtime errors in bundled client libraries.
- **Egress & Compatibility Tests**: Added `tests/egress.spec.ts` and updated `tests/protocols.spec.ts` and `tests/plugin.spec.ts` to cover endpoint normalization and credential fallback behaviors.

## [0.0.3] - 2026-08-31

### Fixed
- **Cordis Profile Patch Optimization**: Removed hardcoded `fetchProvider: http` from `cordis.patch.yml` under `- id: web`, preventing Object Replace patch collisions when coexisting with custom fetch plugins (such as `dsh-web-fetch-enhanced`) and allowing DSH `WebRuntime` to auto-select active fetch providers cleanly.
- **Bundle & Coexistence Testing**: Added `tests/bundle.spec.ts` test suite to verify profile bundle configuration, `cordis.patch.yml` structure, module loader registration, and seamless auto-selection of fetch providers.

## [0.0.2] - 2026-08-30

### Changed
- **Upstream 0.1.2-alpha.2 Settings API Alignment**: Migrated settings registration from deprecated top-level `installSettingsSection` and branded `settingsNamespace` to Cordis service-based `ctx.settings.installSection()` with native kebab-case string namespace, maintaining backwards compatibility with earlier versions.
- **Search Endpoint Failure Guidance**: Added standardized endpoint reporting and configuration recovery instructions to post-dispatch `WebError` failures (network errors, HTTP errors, response parsing errors) to align with upstream search provider behavioral specifications.
- **Verification Tooling**: Hardened `scripts/verify-package.mjs` with sandbox-safe cache directories and multi-pack fallback support.

## [0.0.1] - 2026-08-28

### Added
- Initial release of `dsh-web-search-enhanced`.
- Support for Anthropic Messages, OpenAI Responses, and OpenAI Chat Completions search protocols.
- Follow mode (`current-session`) and fixed search configuration mode.
- DeepSeek Harness Web GUI settings card integration.
