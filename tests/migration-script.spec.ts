import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml } from 'yaml'
import {
  migrateConfigText,
  migrateFile,
  runCli,
  convertFlowToBlock,
  migrateV1ToV2,
} from '../scripts/migrate-config.mjs'

describe('migrateConfigText', () => {
  it('converts JSON flow-style web-search-enhanced in settings.yaml into block-style YAML', () => {
    const input = `ui-theme:
  preference: system
web-search-enhanced:
  {
    version: 2,
    connections:
      {
        builtin:exa: {},
        builtin:firecrawl: {},
        custom:gemini:
          {
            label: Gemini,
            kind: model,
            binding:
              {
                mode: fixed,
                protocol: openai-responses,
                model: gemini-flash-latest,
                baseURL: https://llm.yurzi.net/v1,
                credentialRef: WEB_SEARCH_ENHANCED_API
              },
            options: {},
            trustedEndpoint: true
          }
      }
  }
vision-router:
  routingMode: ordered
`

    const { migrated, output, changes } = migrateConfigText(input)
    expect(migrated).toBe(true)
    expect(output).not.toContain('{\n    version: 2')
    expect(output).toContain('web-search-enhanced:\n  version: 2\n  connections:')
    expect(output).toContain('  version: 2')
    expect(output).toContain('  connections:')
    expect(output).toContain('    custom:gemini:')
    expect(output).toContain('      label: Gemini')
    expect(output).toContain('      kind: model')
    expect(output).toContain('vision-router:')
    expect(changes.some((c: string) => c.includes('JSON / flow-style'))).toBe(true)

    // Verify parsed data matches identically
    const parsed = parseYaml(output)
    expect(parsed['web-search-enhanced'].version).toBe(2)
    expect(parsed['web-search-enhanced'].connections['custom:gemini'].label).toBe('Gemini')
    expect(parsed['vision-router'].routingMode).toBe('ordered')
  })

  it('migrates legacy v1 configured mode into custom:legacy fixed model connection', () => {
    const input = `web-search-enhanced:
  modelMode: configured
  protocol: anthropic-messages
  baseURL: https://api.deepseek.com/anthropic/v1
  model: deepseek-flash
  apiKeyEnv: WEB_SEARCH_ENHANCED_API
  maxTokens: 4096
  searchContextSize: medium
`

    const { migrated, output, changes } = migrateConfigText(input)
    expect(migrated).toBe(true)
    const parsed = parseYaml(output)['web-search-enhanced']
    expect(parsed.version).toBe(2)
    expect(parsed.defaultConnection).toBe('custom:legacy')
    expect(parsed.connections['custom:legacy']).toEqual({
      kind: 'model',
      label: 'Imported search model',
      trustedEndpoint: true,
      binding: {
        mode: 'fixed',
        protocol: 'anthropic-messages',
        model: 'deepseek-flash',
        baseURL: 'https://api.deepseek.com/anthropic/v1',
        credentialRef: 'WEB_SEARCH_ENHANCED_API',
      },
      options: {
        maxTokens: 4096,
        searchContextSize: 'medium',
      },
    })
    expect(parsed.modelMode).toBeUndefined()
    expect(parsed.apiKeyEnv).toBeUndefined()
  })

  it('migrates legacy v1 current-session mode to builtin:session-model', () => {
    const input = `web-search-enhanced:
  modelMode: current-session
  freshness: fresh
`

    const { migrated, output } = migrateConfigText(input)
    expect(migrated).toBe(true)
    const parsed = parseYaml(output)['web-search-enhanced']
    expect(parsed.version).toBe(2)
    expect(parsed.defaultConnection).toBe('builtin:session-model')
    expect(parsed.freshness).toBe('fresh')
    expect(parsed.modelMode).toBeUndefined()
  })

  it('warns and removes plaintext apiKey to preserve security invariants', () => {
    const input = `web-search-enhanced:
  modelMode: configured
  model: deepseek-flash
  apiKey: sk-secret-token-do-not-leak
`

    const { migrated, output, warnings } = migrateConfigText(input)
    expect(migrated).toBe(true)
    expect(output).not.toContain('sk-secret-token-do-not-leak')
    expect(warnings.some((w: string) => w.includes('apiKey'))).toBe(true)
    const parsed = parseYaml(output)['web-search-enhanced']
    expect(parsed.apiKey).toBeUndefined()
  })

  it('migrates standalone JSON configuration to YAML', () => {
    const input = JSON.stringify({
      version: 2,
      defaultConnection: 'builtin:exa',
      connections: {
        'builtin:exa': { access: 'api-key' },
      },
    }, null, 2)

    const { migrated, output, changes } = migrateConfigText(input)
    expect(migrated).toBe(true)
    const parsed = parseYaml(output)
    expect(parsed.version).toBe(2)
    expect(parsed.defaultConnection).toBe('builtin:exa')
    expect(parsed.connections['builtin:exa'].access).toBe('api-key')
  })

  it('is idempotent on already-clean block-style YAML', () => {
    const input = `web-search-enhanced:
  version: 2
  defaultConnection: builtin:exa
  connections:
    builtin:exa: {}
`

    const { migrated, output } = migrateConfigText(input)
    expect(migrated).toBe(false)
    expect(output).toBe(input)
  })

  it('skips migration safely when web-search-enhanced is not present', () => {
    const input = `ui-theme:
  preference: dark
shell:
  timeoutMs: 60000
`

    const { migrated, output } = migrateConfigText(input)
    expect(migrated).toBe(false)
    expect(output).toBe(input)
  })
})

describe('migrateFile and CLI', () => {
  it('creates backup and writes migrated YAML file', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-mig-test-'))
    try {
      const filePath = join(tmp, 'settings.yaml')
      const initial = `web-search-enhanced: { version: 2, connections: { builtin:exa: {} } }`
      writeFileSync(filePath, initial, 'utf8')

      const result = migrateFile(filePath)
      expect(result.success).toBe(true)
      expect(result.migrated).toBe(true)
      expect(result.backupPath).toBe(filePath + '.bak')
      expect(existsSync(filePath + '.bak')).toBe(true)
      expect(readFileSync(filePath + '.bak', 'utf8')).toBe(initial)

      const migratedContent = readFileSync(filePath, 'utf8')
      expect(migratedContent).toContain('web-search-enhanced:')
      expect(migratedContent).toContain('  version: 2')
      expect(migratedContent).toContain('  connections:')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('respects dryRun option without writing to file', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-mig-test-'))
    try {
      const filePath = join(tmp, 'settings.yaml')
      const initial = `web-search-enhanced: { version: 2 }`
      writeFileSync(filePath, initial, 'utf8')

      const result = migrateFile(filePath, { dryRun: true })
      expect(result.migrated).toBe(true)
      expect(result.backupPath).toBeNull()
      expect(readFileSync(filePath, 'utf8')).toBe(initial)
      expect(existsSync(filePath + '.bak')).toBe(false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('CLI returns 0 and displays help on -h', () => {
    const exitCode = runCli(['-h'])
    expect(exitCode).toBe(0)
  })
})
