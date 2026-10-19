/**
 * Shared pieces of the browser build: the DSH platform module table, the CSS
 * Modules compiler that injects one tagged style per stylesheet (mirroring
 * deepseek-harness packages/client/tsdown.client.ts), and a stub resolver for
 * test and fixture builds of the primitives library.
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, resolve } from 'node:path'
import { transform } from 'lightningcss'

/** Modules the DSH web shell shares with every client bundle (deepseek-harness packages/client/web/src/platform.ts). */
export const PLATFORM_MODULES: readonly string[] = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  'zod', '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const isPlatformModule = (specifier: string): boolean => PLATFORM_MODULES.includes(specifier)

/** Client bundle dependency policy: platform modules come from the loader's module table, everything else is inlined. */
export const clientDeps = {
  neverBundle: isPlatformModule,
  alwaysBundle: (specifier: string) => !isPlatformModule(specifier),
  onlyBundle: false as const,
}

const CSS_MODULE_PREFIX = '\0dsh-css-module:'
/** The virtual id must not end in `.css`, or tsdown routes it to its own CSS pipeline. */
const CSS_MODULE_SUFFIX = '.mjs'

interface LoadContext { addWatchFile?(file: string): void }

/**
 * Compile `*.module.css` imports with lightningcss: the module exports its
 * hashed class map and, when a document exists, appends one
 * `<style data-plugin data-plugin-css>` tag per stylesheet.
 * @param pluginId - package name stamped on the injected style tags.
 */
export function cssModules(pluginId: string) {
  return {
    name: 'dsh-css-modules',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css') || importer === undefined) return null
      return CSS_MODULE_PREFIX + resolve(dirname(importer), source) + CSS_MODULE_SUFFIX
    },
    async load(this: LoadContext, id: string) {
      if (!id.startsWith(CSS_MODULE_PREFIX)) return null
      const file = id.slice(CSS_MODULE_PREFIX.length, -CSS_MODULE_SUFFIX.length)
      this.addWatchFile?.(file)
      const { code, exports } = transform({
        filename: file, code: await readFile(file), cssModules: { pattern: '[hash]_[local]' }, minify: true,
      })
      const classes = Object.fromEntries(Object.entries(exports ?? {}).map(([local, value]) => [local, value.name]))
      const tag = JSON.stringify(`${pluginId}/${basename(file)}`)
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(${tag}) + ']') === null) {`,
        "  const style = document.createElement('style');",
        `  style.dataset.plugin = ${JSON.stringify(pluginId)};`,
        `  style.dataset.pluginCss = ${tag};`,
        '  style.textContent = css;',
        '  document.head.appendChild(style);',
        '}',
        `export default ${JSON.stringify(classes)};`,
      ].join('\n')
    },
  }
}

const STUB_PREFIX = '\0dsh-primitives-stub:'
const PRIMITIVES_LIB = /dsh-client-ui-primitives[\\/]lib[\\/]/

/**
 * Test and fixture builds only. The statically linked primitives library keeps
 * bare imports of its own implementation libraries (shiki, katex, micromark,
 * simple-icons, …), which the DSH shell bundles but this repository does not
 * install. Unresolvable ones become inert stubs exporting the names the
 * library imports; this plugin never renders the code paths using them
 * (code highlighting, Markdown, site glyphs).
 */
export function primitivesStub() {
  return {
    name: 'dsh-primitives-stub',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      if (importer === undefined || !PRIMITIVES_LIB.test(importer) || source.startsWith('.') || source.startsWith('\0')) return null
      try {
        createRequire(importer).resolve(source)
        return null
      } catch {
        return `${STUB_PREFIX}${source}?${importer}`
      }
    },
    load(id: string) {
      if (!id.startsWith(STUB_PREFIX)) {
        // The published library references a source map it does not ship.
        return PRIMITIVES_LIB.test(id) && id.endsWith('.js')
          ? readFileSync(id, 'utf8').replace(/\n\/\/# sourceMappingURL=\S+\s*$/, '\n')
          : null
      }
      const [source, importer] = id.slice(STUB_PREFIX.length).split('?') as [string, string]
      const quoted = source.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
      const names = new Set<string>()
      for (const match of readFileSync(importer, 'utf8').matchAll(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${quoted}["']`, 'g'))) {
        for (const binding of match[1]!.split(',')) {
          const name = binding.trim().split(/\s+as\s+/)[0]
          if (name) names.add(name)
        }
      }
      return [
        "const stub = new Proxy(function () {}, { get: (_, key) => key === Symbol.toPrimitive ? () => '' : stub, apply: () => stub, construct: () => stub });",
        'export default stub;',
        ...[...names].map(name => `export const ${name} = stub;`),
      ].join('\n')
    },
  }
}
