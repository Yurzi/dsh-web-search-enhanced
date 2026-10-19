# AGENTS.md

Guidance for coding agents working in this repository.

## What this is

`dsh-web-search-enhanced` is a DeepSeek Harness (DSH) plugin bundle. The Host half takes the native DeepSeek search provider's seat (`deepseek-official`, which the shipped `web` row already selects) behind DSH's native `web_search` tool and lets every session pick its own search connection (keyless services, personal API keys, DeepSeek search, fixed search models, or the session's own model) and content freshness. The client half adds the composer search button, `/setup-search`, the plugin settings page and first-run guidance. It targets DSH `>=0.2.1-rc.2 <0.3.0` and Node `^22.19.0 || >=24.0.0`.

User docs are in Chinese: [README.md](README.md), [docs/configuration.md](docs/configuration.md), [docs/upgrading.md](docs/upgrading.md). Maintainer docs: [docs/architecture.md](docs/architecture.md), [docs/development.md](docs/development.md).

## Layout

```text
src/index.ts            Loader entry: Config schema, edit validation, migrator, search runtime
src/catalog.ts          built-in adapter facts and option rules (shared Host/client)
src/remote-contract.ts  searchConnections Remote schemas and client descriptor (shared)
src/settings/           settings types/version (shared), resolve, option validation, v1 migration
src/search/             errors, bounded HTTP, MCP client, model search, sources, executeSearch
src/search/adapters/    one wire module per adapter + the Adapter seam (types.ts)
src/host/               DSH integration: runtime, step snapshots, selections, pairings, storage,
                        follow-model, connection views, Remote service, web_search restriction
src/client/             composer selector, /setup-search, settings page, locales
locale/                 Plugins page metadata (zh, en)
cordis.patch.yml        bundle patch (disables web-search-deepseek, inserts the plugin row)
scripts/                client build helpers, check-ui (headless Chromium), verify-package
tests/                  Vitest specs (Host in real DSH composition; client in jsdom)
e2e/                    end-to-end suite: real DSH install, plugin manager, Host boot, Web GUI over CDP
```

Shared files are bundled into both halves: no Node- or browser-only APIs there.

## Commands

```sh
pnpm install
pnpm run check        # typecheck → build → test → verify:package; must pass before you finish
pnpm exec vitest run tests/<file>.spec.ts
pnpm run check:ui     # headless Chromium UI checks; CHROMIUM=/path/to/chromium; --screenshots <dir>
pnpm run test:e2e     # isolated real DSH under .e2e/ (see docs/development.md); networked on first run
```

Run `test:e2e` when touching the bundle patch, provider registration, the settings page or the DSH baseline. It never touches the user's own DSH home, profiles or running GUI.

Do not run state-changing git commands unless asked. Do not edit `pnpm-lock.yaml` or add dependencies without approval.

## Conventions

- Readable code over dense one-liners; small focused modules; JSDoc on exports only when it adds information.
- No over-defensive code: no try/catch that swallows errors "to be safe", no shape-sniffing of private host internals, no piles of `?.`/`??` for values that are always present, no timing-based correctness (`setTimeout`/microtask ordering).
- Discriminated unions instead of bags of optional fields: one value states one fact.
- Model-facing errors use `searchError(code, message)`: concise English with an actionable hint and an existing `WEB_*` code. Never include upstream bodies, causes or secrets.
- All UI text goes through `src/client/locales.ts` (zh and en, same keys and placeholders). The Host returns status codes and English diagnostics; the client localizes them.
- Styling: CSS Modules with DSH `--dsw-*` tokens and `@deepseek-ai/dsh-client-ui-primitives` components. No inline colors, no global selectors, no JS layout measurement where CSS works.
- Keys live only in DSH Credentials. Settings store credential references (`credentialRef`), never key values. Keyless access never reads or sends a key and never falls back to one.
- Keep the security limits: redirects rejected, 2 MiB response cap, 90 s per search, no automatic retry or fallback, custom endpoints need explicit `trustedEndpoint`.
- Settings are sparse: write only differences from the inherited layer; the catalog supplies defaults.

## Adding a search adapter

1. Add an entry to `ADAPTERS` in `src/catalog.ts` (position = display order; id becomes `builtin:<id>`).
2. Implement `Adapter` in `src/search/adapters/<id>.ts`; provide a `keyless` route only if the catalog says `keyless: true`; map `input.freshness` only if the catalog lists the access mode.
3. Register it in `src/search/adapters/index.ts` (`ADAPTER_WIRES` is typed to require it).
4. Add option copy to `ADAPTER_OPTION_COPY` in `src/client/settings/model.ts` and labels, placeholders and enum value labels to both dictionaries in `src/client/locales.ts`.
5. Cover request and response shapes in `tests/adapters.spec.ts` with fixtures shaped after the official docs.
6. Update docs/configuration.md (tables), the README connection table and CHANGELOG.md.

## Testing policy

- Prefer the real DSH composition (Cordis, WebRuntime, JSON storage-domain, Typert, Session Controller, tool runtime) over mocks. Mock only the network (`fetch`) and the clock.
- Test behavior a user or the model can observe, not implementation details or private call order.
- Every bug fix gets a test that fails without it. Remove tests that only pin incidental structure.
- Client components render the real primitives in jsdom (`tests/client-harness.tsx`); UI layout belongs in `scripts/check-ui.mjs`.

## Don'ts

- Don't change the shared contracts (`catalog.ts`, `settings/types.ts`, `settings/version.ts`, `remote-contract.ts`) casually: they bind the Host, the client and stored data. A breaking settings change needs a `CURRENT_CONFIG_VERSION` bump and a pure migration step.
- Don't rename public error codes, the default provider id `deepseek-official`, the Loader entry id `web-search-enhanced` or the storage domain `web_search_enhanced`.
- Don't make `providerId` volatile or part of the settings document: it is the one ordinary Config field, edited in the Profile only, and a change remounts the plugin to register under the new id. The browser learns it from `searchConnections/provider`.
- Don't patch the shared `web` row (or any row another plugin relies on) in `cordis.patch.yml`: a patch replaces the row's whole config, so writing `searchProvider` drops `fetchProvider` and breaks web_fetch plugins such as dsh-web-fetch-enhanced. Take a seat the base already selects instead.
- Don't read private DSH internals (adapter registries, pi-ai catalogs); use public services and settings.
- Don't hard-code user-visible strings in components; the Host emits only codes and English model-facing text, never localized UI copy.
- Don't make the provider's `available()` do I/O.
- Don't commit API keys, real user queries or recorded upstream responses containing secrets.
