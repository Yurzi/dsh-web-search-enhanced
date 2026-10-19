import { readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { defineConfig, type UserConfig } from 'tsdown'
import { clientDeps, cssModules } from './scripts/client-build.ts'

const { name: id, version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { name: string; version: string }
const mode = process.env.NODE_ENV ?? 'production'
const isHostExternal = (dependency: string): boolean => isBuiltin(dependency) || dependency.startsWith('@deepseek-ai/')

const host: UserConfig = {
  name: id,
  entry: { index: 'lib/types/index.js' },
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'node22', fixedExtension: false, dts: false, clean: false,
  deps: { neverBundle: isHostExternal, alwaysBundle: dependency => !isHostExternal(dependency) },
  define: { __PLUGIN_VERSION__: JSON.stringify(version) },
}

/**
 * Browser half in the DSH client module format: one script that registers a
 * `factory(require)` with `window.__ModuleLoader__`. Only the shell's platform
 * modules stay external; CSS Modules compile into the bundle and inject
 * tagged styles (see deepseek-harness packages/client/tsdown.client.ts).
 */
const client: UserConfig = {
  name: id + '/client',
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib', format: ['cjs'], platform: 'browser', target: 'es2024', dts: false, clean: false, sourcemap: true,
  deps: clientDeps,
  inputOptions: { resolve: { conditionNames: [mode === 'development' ? 'development' : 'production', 'browser', 'import', 'module', 'default'] } },
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
    'import.meta.env.MODE': JSON.stringify(mode),
    'import.meta.env': JSON.stringify({ MODE: mode }),
  },
  plugins: [cssModules(id)],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(id) + ', factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([host, client])
