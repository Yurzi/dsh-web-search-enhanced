import { describe, it, expect } from 'vitest'
import { SessionSelections, type Selection, type SelectionTable } from '../src/dsh/session-selection.ts'
function table(): SelectionTable {
 const rows = new Map<string,Selection>(); let tail = Promise.resolve()
 return { get: id => rows.get(id), put: async (id,v) => { rows.set(id,structuredClone(v)) }, delete: async id => rows.delete(id), update: (id,fn) => {
   const p = tail.then(() => { const next = fn(rows.get(id)!); rows.set(id,next); return next }); tail = p.then(() => {}, () => {}); return p
 } }
}
describe('durable session selections', () => {
 it('materializes legacy defaults once without resetting null, identity or revision', async () => {
  const t = table(), state = new SessionSelections(t)
  await t.put('null', {connectionId:null,revision:7})
  await t.put('deleted', {connectionId:'custom:gone',revision:3})
  const neverInitialize = async (): Promise<null> => { throw new Error('must not initialize legacy connection') }
  expect(await state.get('null',neverInitialize,'fresh')).toEqual({connectionId:null,revision:7,freshness:'fresh'})
  expect(await state.get('deleted',neverInitialize,'realtime')).toEqual({connectionId:'custom:gone',revision:3,freshness:'realtime'})
  const reopened = new SessionSelections(t)
  expect((await reopened.get('null',neverInitialize,'auto')).freshness).toBe('fresh')
  expect((await reopened.get('deleted',neverInitialize,'auto')).freshness).toBe('realtime')
  expect(await reopened.set('null',{connectionId:'builtin:exa'},7)).toEqual({connectionId:'builtin:exa',revision:8,freshness:'fresh'})
 })
 it('uses one CAS revision for connection and freshness, including across storage clients', async () => {
  const t = table(), a = new SessionSelections(t), b = new SessionSelections(t)
  await a.get('one',async()=>null,'fresh')
  await a.get('two',async()=>null,'auto')
  const results = await Promise.allSettled([a.set('one',{freshness:'realtime'},0),b.set('one',{connectionId:'builtin:exa'},0)])
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
  expect(results.filter(r=>r.status==='rejected')).toHaveLength(1)
  expect((await a.get('two',async()=>null,'realtime')).freshness).toBe('auto')
  await a.set('one',{freshness:'fresh'},1)
  await expect(b.set('one',{connectionId:null},1)).rejects.toThrow('another window')
  await a.set('one',{connectionId:'builtin:exa'},2)
  await expect(b.set('one',{freshness:'auto'},2)).rejects.toThrow('another window')
  expect((await a.get('one',async()=>null)).freshness).toBe('fresh')
 })
 it('inherits both fields once and permits independent fork edits', async () => {
  const state = new SessionSelections(table())
  await state.get('parent',async()=>null,'realtime')
  expect(await state.fork('parent','fork',async()=>null,'auto')).toEqual({connectionId:null,revision:0,freshness:'realtime'})
  await state.set('fork',{connectionId:'builtin:exa',freshness:'fresh'},0)
  await state.set('parent',{freshness:'auto'},0)
  expect(await state.fork('parent','fork',async()=>null)).toEqual({connectionId:'builtin:exa',revision:1,freshness:'fresh'})
  expect(await state.get('parent',async()=>null)).toEqual({connectionId:null,revision:1,freshness:'auto'})
 })
 it('does not confirm failed legacy materialization and retries safely', async () => {
  const t = table(); await t.put('old',{connectionId:null,revision:2})
  const update = t.update; t.update = async()=>{throw new Error('disk unavailable')}
  const state = new SessionSelections(t)
  await expect(state.get('old',async()=>null,'fresh')).rejects.toThrow('disk unavailable')
  expect(t.get('old')).toEqual({connectionId:null,revision:2})
  t.update = update
  expect(await state.get('old',async()=>null,'realtime')).toEqual({connectionId:null,revision:2,freshness:'realtime'})
 })
 it('serializes first initialization and rejects stale writes', async () => {
  const t = table(), state = new SessionSelections(t)
  const [a,b] = await Promise.all([state.get('a',async ()=>'builtin:exa'),state.get('a',async ()=>'builtin:tavily')])
  expect(a).toEqual(b)
  const results = await Promise.allSettled([state.set('a','builtin:firecrawl',0),state.set('a','builtin:tavily',0)])
  expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected'])
  expect(await new SessionSelections(t).get('a',async ()=>'builtin:tinyfish')).toEqual({ connectionId:'builtin:firecrawl',revision:1,freshness:'auto' })
 })
 it('retains deleted connection identity, isolates forks and cleans deletion', async () => {
  const state = new SessionSelections(table())
  await state.get('a',async ()=>'custom:deleted'); await state.fork('a','b',async ()=>null)
  await state.set('b','builtin:exa',0)
  expect((await state.get('a',async ()=>null)).connectionId).toBe('custom:deleted')
  await state.delete('b'); expect(await state.get('b',async ()=>null)).toEqual({connectionId:null,revision:0,freshness:'auto'})
 })
 it('never confirms failed persistence or poisons subsequent work', async () => {
  const t = table(); let fail = true; const put = t.put
  t.put = async (id,v) => { if (fail) throw new Error('storage unavailable'); await put(id,v) }
  const state = new SessionSelections(t)
  await expect(state.get('a',async ()=>'builtin:exa')).rejects.toThrow('storage unavailable')
  expect(t.get('a')).toBeUndefined(); fail = false
  expect(await state.get('a',async ()=>null)).toEqual({connectionId:null,revision:0,freshness:'auto'})
 })
})
