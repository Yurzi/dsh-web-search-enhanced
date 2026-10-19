import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

it('keeps the zh and en dictionaries complete and their placeholders paired', () => {
  expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
  for (const key of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]))
})

it('ships Plugins page metadata in both languages', () => {
  for (const locale of ['en', 'zh']) {
    const { meta } = JSON.parse(readFileSync(new URL('../locale/' + locale + '.json', import.meta.url), 'utf8'))
    expect(meta.title).toBeTypeOf('string')
    expect(meta.description).toBeTypeOf('string')
  }
})
