import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { V2Settings, type V2SettingsProps } from '../src/client/V2Settings.tsx'
function render(writable=true) {
  const describe = vi.fn()
  const scope={subscribe:()=>()=>{},getSnapshot:()=>({status:'ready',writable,revision:1,value:{version:2,defaultConnection:'builtin:exa'}})}
  const html=renderToStaticMarkup(createElement(V2Settings,{scope,credentials:{describe}} as unknown as V2SettingsProps))
  return {html,describe}
}
describe('DSH-styled settings rendering',()=>{
  it('renders labelled access modes and keyless rows without credentials or network calls',()=>{
    const {html,describe}=render()
    expect(html).toContain('Exa 访问方式');expect(html).toContain('Firecrawl 访问方式')
    expect(html).toContain('个人 API Key');expect(html).toContain('免 Key（限额）')
    expect(html).toContain('aria-expanded="true"');expect(html).toContain('--dsw-alias-border-l2')
    expect(html).not.toContain('宿主有效模型绑定不可用');expect(describe).not.toHaveBeenCalled()
  })
  it('renders readonly notice and accessible form names',()=>{
    const {html}=render(false)
    expect(html).toContain('当前设置只读');expect(html).toContain('新会话默认连接')
    expect(html).toContain('aria-controls=');expect(html).toContain('disabled=""')
  })
})
