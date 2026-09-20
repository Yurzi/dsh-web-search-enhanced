import { defineConfig } from 'vitest/config'
import ts from 'typescript'

export default defineConfig({
  // OXC currently leaves standard decorators intact. Match our production tsc
  // lowering for the service that uses the real DSH @Remote decorator.
  plugins: [{ name: 'dsh-standard-decorators', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/dsh/bridge.ts')) return
    return { code: ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, sourceMap: true } }).outputText, map: null }
  } }],
  test: { include: ['tests/**/*.spec.ts'], coverage: { reporter: ['text', 'json-summary'] } },
})
