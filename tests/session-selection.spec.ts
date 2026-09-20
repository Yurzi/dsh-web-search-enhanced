import { describe, it, expect } from 'vitest'
import { SessionSelections, type Selection, type SelectionTable } from '../src/dsh/session-selection.ts'
function table(): SelectionTable {
 const rows = new Map<string,Selection>(); let tail = Promise.resolve()
 return { get: id => rows.get(id), put: async (id,v) => { rows.set(id,structuredClone(v)) }, delete: async id => rows.delete(id), update: (id,fn) => {
   const p = tail.then(() => { const next = fn(rows.get(id)!); rows.set(id,next); return next }); tail = p.then(() => {}, () => {}); return p
 } }
}
describe('durable session selections', () => {
 it('serializes first initialization and rejects stale writes', async () => {
  const t = table(), state = new SessionSelections(t)
  const [a,b] = await Promise.all([state.get('a',async ()=>'builtin:exa'),state.get('a',async ()=>'builtin:tavily')])
  expect(a).toEqual(b)
  const results = await Promise.allSettled([state.set('a','builtin:firecrawl',0),state.set('a','builtin:tavily',0)])
  expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected'])
  expect(await new SessionSelections(t).get('a',async ()=>'builtin:tinyfish')).toEqual({ connectionId:'builtin:firecrawl',revision:1 })
 })
 it('retains deleted connection identity, isolates forks and cleans deletion', async () => {
  const state = new SessionSelections(table())
  await state.get('a',async ()=>'custom:deleted'); await state.fork('a','b',async ()=>null)
  await state.set('b','builtin:exa',0)
  expect((await state.get('a',async ()=>null)).connectionId).toBe('custom:deleted')
  await state.delete('b'); expect(await state.get('b',async ()=>null)).toEqual({connectionId:null,revision:0})
 })
 it('never confirms failed persistence or poisons subsequent work', async () => {
  const t = table(); let fail = true; const put = t.put
  t.put = async (id,v) => { if (fail) throw new Error('storage unavailable'); await put(id,v) }
  const state = new SessionSelections(t)
  await expect(state.get('a',async ()=>'builtin:exa')).rejects.toThrow('storage unavailable')
  expect(t.get('a')).toBeUndefined(); fail = false
  expect(await state.get('a',async ()=>null)).toEqual({connectionId:null,revision:0})
 })
})
