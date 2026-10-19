/** Adapter option validation driven by the catalog's option rules; dependency-free for the client. */
import { ADAPTERS, type AdapterId, type OptionRule } from '../catalog.ts'
import type { Access } from './types.ts'

/**
 * Check adapter options against the catalog. Keyless access may reject an
 * option or narrow its values.
 * @returns one English problem per invalid option; empty when all are valid.
 */
export function validateOptions(adapter: AdapterId, options: Readonly<Record<string, unknown>>, access: Access): string[] {
  const { label } = ADAPTERS[adapter]
  const rules: Readonly<Record<string, OptionRule>> = ADAPTERS[adapter].options
  return Object.entries(options).flatMap(([key, value]) => {
    const rule = Object.hasOwn(rules, key) ? rules[key] : undefined
    if (rule === undefined) return [`${label} has no option "${key}"`]
    if (!accepts(rule, value)) return [`${label} option "${key}" has an invalid value`]
    if (access === 'keyless' && !keylessAccepts(rule, value)) return [`${label} option "${key}" = ${JSON.stringify(value)} needs API-key access`]
    return []
  })
}

function accepts(rule: OptionRule, value: unknown): boolean {
  switch (rule.kind) {
    case 'enum': return typeof value === 'string' && rule.values.includes(value)
    case 'text': return typeof value === 'string' && rule.pattern.test(value)
    case 'boolean': return typeof value === 'boolean'
  }
}

function keylessAccepts(rule: OptionRule, value: unknown): boolean {
  if (rule.keyless === undefined) return true
  if (rule.keyless === false) return false
  return rule.keyless.includes(value as string)
}
