import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import ts from 'typescript'
import { cssModules, primitivesStub } from './scripts/client-build.ts'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  define: { __PLUGIN_VERSION__: JSON.stringify(version) },
  plugins: [
    // OXC currently leaves standard decorators intact. Match our production tsc
    // lowering for our services that use the real DSH @Remote decorator.
    { name: 'dsh-standard-decorators', enforce: 'pre', transform(code, id) {
      if (!id.includes('/src/') || !id.endsWith('.ts') || !code.includes('@Remote')) return
      return { code: ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, sourceMap: true } }).outputText, map: null }
    } },
    // Client components render the real primitives: compile their CSS Modules
    // as the client bundle does, and stub the libraries the shell bundles for them.
    cssModules('dsh-web-search-enhanced'),
    primitivesStub(),
  ],
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    server: { deps: { inline: ['@deepseek-ai/dsh-client-ui-primitives'] } },
    coverage: { reporter: ['text', 'json-summary'] },
  },
})
