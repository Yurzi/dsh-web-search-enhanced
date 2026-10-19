import { existsSync, readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { PLATFORM_MODULES } from '../scripts/client-build.ts'

const file = new URL('../lib/client.js', import.meta.url)

interface Registration {
  readonly id: string
  readonly factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}

it.skipIf(!existsSync(file))('registers the built client with the module loader, requiring only DSH platform modules', async () => {
  const source = readFileSync(file, 'utf8')
  let registration: Registration | undefined
  runInNewContext(source, { window: { __ModuleLoader__: { load: (value: Registration) => { registration = value } } } })
  expect(registration?.id).toBe('dsh-web-search-enhanced')
  const modules: Record<string, unknown> = {
    'react': await import('react'),
    'react/jsx-runtime': await import('react/jsx-runtime'),
    'react-dom': await import('react-dom'),
    'zod': await import('zod'),
    '@deepseek-ai/dsh-client-store': await import('@deepseek-ai/dsh-client-store'),
    '@deepseek-ai/dsh-client-ui-primitives': await import('@deepseek-ai/dsh-client-ui-primitives'),
  }
  const requested = new Set<string>()
  const exports = registration!.factory((specifier) => {
    requested.add(specifier)
    if (!(specifier in modules)) throw new Error('unexpected module request: ' + specifier)
    return modules[specifier]
  })
  expect([...requested].filter(specifier => !PLATFORM_MODULES.includes(specifier))).toEqual([])
  expect(exports.apply).toBeTypeOf('function')
  expect(exports.inject).toEqual(['connection', 'slots', 'locale', 'configForms', 'remote', 'remote.credentials'])
  // CSS Modules arrive as tagged, once-per-stylesheet style injections.
  expect(source).toContain('dataset.pluginCss')
})
