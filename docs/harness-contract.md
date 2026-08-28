# Harness Contract

## Source of truth

Extracted from DeepSeek Harness commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` and source package line `0.1.2-alpha.1`. Installable dependencies use the npm `next` line `0.1.1-rc.2`; source and registry baselines are intentionally recorded separately.

Representative sources:

- `packages/fs/tool-fs/src/index.ts`: named Cordis exports, Schemastery config, required and conditional injection.
- `packages/core/tools/src/schema.ts`: tool definitions and execution contracts.
- `packages/client/tsdown.client.ts`: ModuleLoader output, external purity, CSS, and build faces.
- `packages/client/ui-settings-plugins/package.json`: `dsh.client`, exports, peers, and files.
- `packages/client/ui-settings-plugins/src/client/index.ts`: browser surface ownership.
- `packages/api/settings-controller/src/index.ts`: redacted settings namespaces and Remote ownership.

## Portable contract retained here

One package exposes a Node host half and optional browser half. `dsh.bundle.patch` publishes composition defaults; `dsh.client` declares browser dependencies. Client output calls `window.__ModuleLoader__.load` and resolves shared identity through injected `require`. TypeScript uses strict NodeNext semantics, relative runtime imports end in `.js`, declarations live under `lib/types`, and published files are explicit.

## Deliberately not copied

The internal monorepo uses `workspace:^`, project references, generated catalogs, build faces, Typert generators, oxlint, package-invariant gates, static-linked client channels, and root release orchestration. Those are repository infrastructure, not portable plugin API. Typert generation is especially monorepo-bound today, so this basic template demonstrates a narrow optional RPC adapter instead of copying generated internals.

## Upgrade checklist

- Compare DSH package versions and Node/pnpm engines.
- Inspect `packages/client/tsdown.client.ts` for loader, external, CSS, and build changes.
- Inspect a current tool package for `defineTool` changes.
- Inspect a current client package for slot, locale, and `dsh.client.inject` changes.
- Run `pnpm run check`, then verify the packed plugin in the current DSH GUI after refresh.
