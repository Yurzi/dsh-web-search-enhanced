import { existsSync, readFileSync, statSync, promises as fsPromises } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ModelSelection, SessionModelAgent } from './session-model.ts'

export interface ModelPairingCacheFile {
  version: 1
  updatedAt?: string
  pairings: Record<string, string | null>
}

export function resolveDefaultCacheDir(): string {
  const env = process.env.DSH_HOME?.trim()
  const dshHome = env || path.join(os.homedir(), '.dsh')
  return path.join(dshHome, 'cache', 'web-search-enhanced')
}

export function formatModelKey(provider?: string, model?: string): string | undefined {
  if (!model?.trim()) return undefined
  const m = model.trim()
  const p = provider?.trim()
  return p ? `${p}:${m}` : m
}

/** Pairing preference follows the next selected model; execution uses sessionModelSelection instead. */
export function extractSessionModel(
  agent?: SessionModelAgent | Agent,
  ctx?: Context
): { provider?: string; model?: string } | undefined {
  if (!agent) return undefined
  const projections = ctx?.get('sessionProjections') as {
    stateOf?: (session: unknown, key: string) => {
      pending?: ModelSelection | null
      lastUsed?: ModelSelection | null
    } | undefined
  } | undefined
  // The projection owns pending intent and its consumption by request/header.
  // Scanning the latest model/selection event alone can resurrect consumed intent.
  const state = projections?.stateOf?.(agent.session, 'modelSelection')
  const projected = state?.pending ?? state?.lastUsed
  const pair = (value: ModelSelection): ModelSelection => ({
    ...(value.provider ? { provider: value.provider } : {}), ...(value.model ? { model: value.model } : {}),
  })
  if (projected?.model) return pair(projected)

  const header = agent.session.requestHeader()
  if (header !== undefined) return header.config?.model ? pair(header.config) : undefined
  if (agent.options?.model) return pair(agent.options)
  const defaults = ctx?.get('agentDefaultModel') as {
    currentSelection(): ModelSelection
  } | undefined
  const current = defaults?.currentSelection()
  return current?.model ? pair(current) : undefined
}

export class ModelPairingStore {
  readonly cacheDir: string
  readonly filePath: string
  private pairings: Record<string, string | null> = Object.create(null)
  private loaded = false
  private lastMtime = 0
  private saveTail: Promise<void> = Promise.resolve()

  constructor(options?: { cacheDir?: string }) {
    this.cacheDir = options?.cacheDir ?? resolveDefaultCacheDir()
    this.filePath = path.join(this.cacheDir, 'model-connections.json')
  }

  loadIfNeeded(): void {
    try {
      if (!existsSync(this.filePath)) {
        this.loaded = true
        return
      }
      const stat = statSync(this.filePath)
      if (this.loaded && stat.mtimeMs <= this.lastMtime) return
      const raw = readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as ModelPairingCacheFile
      if (parsed && typeof parsed === 'object' && parsed.pairings && typeof parsed.pairings === 'object') {
        const next: Record<string, string | null> = Object.create(null)
        for (const [k, v] of Object.entries(parsed.pairings)) {
          if (typeof v === 'string' || v === null) {
            next[k] = v
          }
        }
        this.pairings = next
      }
      this.lastMtime = stat.mtimeMs
      this.loaded = true
    } catch (err) {
      this.loaded = true
      console.warn('[web-search-enhanced] Failed to load model connection cache, using memory defaults:', err)
    }
  }

  get(provider?: string, model?: string): string | null | undefined {
    if (!model?.trim()) return undefined
    this.loadIfNeeded()
    const m = model.trim()
    const p = provider?.trim()
    if (p) {
      const fullKey = `${p}:${m}`
      if (Object.hasOwn(this.pairings, fullKey)) {
        return this.pairings[fullKey]
      }
    }
    if (Object.hasOwn(this.pairings, m)) {
      return this.pairings[m]
    }
    return undefined
  }

  async set(provider: string | undefined, model: string, connectionId: string | null): Promise<void> {
    if (!model?.trim()) return
    this.loadIfNeeded()
    const key = formatModelKey(provider, model)
    if (!key) return
    this.pairings[key] = connectionId
    await this.save()
  }

  async save(): Promise<void> {
    const task = this.saveTail.then(async () => {
      await this.persistToFile()
    }).catch(err => {
      console.warn('[web-search-enhanced] Failed to persist model connection cache:', err)
    })
    this.saveTail = task
    return task
  }

  private async persistToFile(): Promise<void> {
    const dir = this.cacheDir
    await fsPromises.mkdir(dir, { recursive: true })
    const data: ModelPairingCacheFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      pairings: { ...this.pairings },
    }
    const content = JSON.stringify(data, null, 2)
    const tmpFile = path.join(dir, `model-connections.json.tmp.${process.pid}.${Date.now()}`)
    await fsPromises.writeFile(tmpFile, content, 'utf8')
    await fsPromises.rename(tmpFile, this.filePath)
    try {
      const stat = statSync(this.filePath)
      this.lastMtime = stat.mtimeMs
    } catch { /* ignore */ }
  }

  snapshot(): Readonly<Record<string, string | null>> {
    this.loadIfNeeded()
    return { ...this.pairings }
  }
}