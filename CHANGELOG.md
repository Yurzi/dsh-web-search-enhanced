# Changelog

All notable changes to the `dsh-web-search-enhanced` package will be documented in this file.

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