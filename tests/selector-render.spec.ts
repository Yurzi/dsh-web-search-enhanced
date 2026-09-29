import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SearchSelectorControl, type SearchSelectionResponse } from '../src/client/SearchConnectionSelector.tsx'
import { selectorCss } from '../src/client/search-selector.css.ts'
import { en, zh, type LocaleKey } from '../src/client/locales.ts'
const connections = [
  {id:'builtin:exa',label:'Exa',kind:'structured' as const,configured:true,keyless:true},
  {id:'builtin:session-model',label:'跟随会话模型',kind:'model' as const,configured:false,reason:'private availability detail',credentialRef:'PRIVATE_REFERENCE'},
]
function render(extra: Partial<Parameters<typeof SearchSelectorControl>[0]> = {}) {
  const value: SearchSelectionResponse = {selection:{connectionId:'builtin:exa',revision:1},freshness:'realtime',connections}
  return renderToStaticMarkup(createElement(SearchSelectorControl,{t: key => zh[key as LocaleKey] ?? key,value,connections,pending:false,error:'',notice:'',onSelect:vi.fn(),onFreshness:vi.fn(),onRefresh:vi.fn(),...extra}))
}
describe('compact native-style search picker',()=>{
  it('uses the injected locale for selector labels and accessibility copy', () => {
    const html = render({ t: key => en[key as LocaleKey] ?? key })
    expect(html).toContain('Current session search settings')
    expect(html).toContain('Current session content freshness')
    expect(html).toContain('Prefer realtime')
    expect(html).toContain('Search connection: Exa')
    expect(html).not.toContain('当前会话')
  })
  it('keeps configuration and availability details out of the picker',()=>{
    const html=render()
    expect(html).not.toContain('private availability detail');expect(html).not.toContain('PRIVATE_REFERENCE')
    expect(html).not.toContain('<details');expect(html).not.toContain('全局')
    expect(html).toContain('popover="auto"');expect(html).toContain('当前会话内容实时性')
    expect(html).toContain('优先新鲜');expect(html).toContain('优先实时')
    expect(html).not.toContain('跟随会话模型')
    expect(html).not.toContain('v2s-search-heading')
    expect(html).not.toContain('模型搜索')
    expect(html).toContain('<span>Exa</span>')
  })
  it('uses native model-picker metrics and keeps feedback out of normal layout',()=>{
    expect(selectorCss).toContain('height:28px');expect(selectorCss).toContain('border-radius:24px')
    expect(selectorCss).toContain('--dsw-specific-menu');expect(selectorCss).toContain('border-radius:16px')
    const html=render({notice:'已保存'})
    expect(html).toContain('class="v2s-search-sr" role="status"');expect(html).toContain('aria-expanded="false"')
  })
  it('hides empty groups without changing an unavailable saved selection',()=>{
    const html=render({connections:connections.map(c=>({...c,configured:false}))})
    expect(html).not.toContain('<span>Exa</span>')
    expect(html).toContain('<span>关闭</span>')
    expect(html).not.toContain('aria-label="搜索服务"')
    expect(html).not.toContain('aria-label="模型搜索"')
    expect(html).toContain('搜索连接：Exa')
    expect(html).toContain('当前会话内容实时性')
  })
  it('renders closed search status when connectionId is null', () => {
    const htmlZh = render({ value: { selection: { connectionId: null, revision: 2 }, freshness: 'realtime', connections } })
    expect(htmlZh).toContain('aria-label="搜索连接：关闭"')
    expect(htmlZh).toContain('title="搜索连接：关闭"')
    expect(htmlZh).toContain('<span class="v2s-search-label">关闭</span>')
    expect(htmlZh).not.toContain('class="v2s-search-mode"')
    expect(htmlZh).toContain('aria-pressed="true"><span>关闭</span><span class="v2s-search-option-check" aria-hidden="true">✓</span>')

    const htmlEn = render({
      t: key => en[key as LocaleKey] ?? key,
      value: { selection: { connectionId: null, revision: 2 }, freshness: 'realtime', connections },
    })
    expect(htmlEn).toContain('aria-label="Search connection: Off"')
    expect(htmlEn).toContain('<span class="v2s-search-label">Off</span>')
    expect(htmlEn).toContain('aria-pressed="true"><span>Off</span><span class="v2s-search-option-check" aria-hidden="true">✓</span>')
  })
  it('preserves loading and actionable error feedback',()=>{
    const html=render({value:undefined,error:'保存失败'})
    expect(html).toContain('role="alert"');expect(html).toContain('重试')
    expect(html).toContain('disabled=""');expect(html).toContain('保存失败')
  })
  it('unifies responsive design boundaries with official conversation.input.model while supporting dsh-mobile auto-scaling',()=>{
    expect(selectorCss).toContain('--dsh-composer-model-text-display')
    expect(selectorCss).toContain('data-model-compact')
    expect(selectorCss).toContain('max-width:min(360px,45cqw)')
    expect(selectorCss).toContain('@container(width<=420px)')
    expect(selectorCss).toContain('@container(width<=360px)')
    expect(selectorCss).toContain('data-dsh-mobile-composer-row')
    expect(selectorCss).toContain('.v2s-search-mode { flex-shrink:1000;')
  })
})
