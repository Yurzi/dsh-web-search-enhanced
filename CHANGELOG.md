# Changelog

All notable changes to the `dsh-web-search-enhanced` package will be documented in this file.

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
