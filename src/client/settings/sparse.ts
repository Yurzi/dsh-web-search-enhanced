/**
 * Sparse settings writes. The catalog supplies every default, so a write
 * stores only what differs from the inherited (composition) layer, and
 * returning a value to its inherited state removes the user entry instead of
 * materializing it.
 */
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { configVersion, CURRENT_CONFIG_VERSION } from '../../settings/version.ts'

/** The two layers of a ConfigForm snapshot. */
export interface SettingsLayers {
  readonly base?: unknown
  readonly user?: unknown
}

type Settable = Extract<SettingsPathOpView, { op: 'set' }>['value']
type Json = Record<string, unknown>

const objectOf = (value: unknown): Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}

const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]))
  }
  if (!isObject(a) || !isObject(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]))
}

/** Remove what an object value shares with its inherited counterpart, key by key. */
function delta(value: unknown, inherited: unknown): unknown {
  if (equal(value, inherited)) return undefined
  if (!isObject(value)) return value
  const base = objectOf(inherited)
  return Object.fromEntries(Object.entries(value)
    .map(([key, child]) => [key, delta(child, base[key])] as const)
    .filter(([, child]) => child !== undefined))
}

/**
 * Whether this page may edit the document: older documents wait for the Host
 * migration, and a newer or malformed version is never overwritten.
 */
export type DocumentVersion = 'current' | 'legacy' | 'unsupported'

export function documentVersion(layers: SettingsLayers): DocumentVersion {
  let version: number
  try {
    version = configVersion({ ...objectOf(layers.base), ...objectOf(layers.user) })
  } catch {
    return 'unsupported'
  }
  return version === CURRENT_CONFIG_VERSION ? 'current' : 'legacy'
}

function assertCurrentVersion(layers: SettingsLayers): void {
  if (documentVersion(layers) !== 'current') throw new Error('settings migration required')
}

/**
 * Operations that make `path` hold `target`, touching only that path.
 * @param fallback - the catalog default used when the base layer has no value.
 * @param target - the desired effective value; undefined returns the path to its inherited value.
 */
export function sparseSettingOperations(layers: SettingsLayers, path: readonly string[], target: unknown, fallback?: unknown): SettingsPathOpView[] {
  assertCurrentVersion(layers)
  const at = (root: unknown) => path.reduce<unknown>((value, key) => objectOf(value)[key], root)
  const inherited = at(layers.base) ?? fallback
  const user = at(layers.user)
  const ops: SettingsPathOpView[] = []
  if (target === undefined || equal(target, inherited)) {
    if (user !== undefined) ops.push({ op: 'unset', path: [...path] })
  } else {
    const sparse = delta(target, inherited)
    if (!equal(sparse, user)) ops.push({ op: 'set', path: [...path], value: sparse as Settable })
  }
  const version = objectOf(layers.user).version ?? objectOf(layers.base).version
  if (ops.some(op => op.op === 'set') && version !== CURRENT_CONFIG_VERSION) {
    ops.push({ op: 'set', path: ['version'], value: CURRENT_CONFIG_VERSION })
  }
  return ops
}

const FIELDS = ['version', 'freshness', 'defaultConnection', 'showSelector', 'connections'] as const

/** Unset every field this plugin stores in the user layer; inherited values and credentials stay. */
export function resetSettingsOperations(layers: SettingsLayers): SettingsPathOpView[] {
  assertCurrentVersion(layers)
  const user = objectOf(layers.user)
  return FIELDS.filter(key => Object.hasOwn(user, key)).map(key => ({ op: 'unset', path: [key] }))
}
