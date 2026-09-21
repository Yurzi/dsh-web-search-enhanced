# 更新日志

记录 `dsh-web-search-enhanced` 的用户可见变化。历史条目描述对应版本，不代表当前行为。

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
