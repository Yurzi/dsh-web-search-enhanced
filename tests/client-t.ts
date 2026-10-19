/** Locale lookups with the host's {name} interpolation, for client specs. */
import type { Translate } from '../src/client/connections.ts'
import { en, zh } from '../src/client/locales.ts'

const translator = (dictionary: Readonly<Record<string, string>>): Translate => (key, params) =>
  (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] === undefined ? match : String(params[name]))

export const tZh = translator(zh)
export const tEn = translator(en)
