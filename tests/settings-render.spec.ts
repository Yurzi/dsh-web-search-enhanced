import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { V2Settings, type V2SettingsProps } from '../src/client/V2Settings.tsx'
import { v2CardCss } from '../src/client/v2-settings.css.ts'

function render(writable = true) {
  const describe = vi.fn()
  const scope = { subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready', writable, revision: 1, value: { version: 2, defaultConnection: 'builtin:exa' } }) }
  const html = renderToStaticMarkup(createElement(V2Settings, { scope, credentials: { describe } } as unknown as V2SettingsProps))
  return { html, describe }
}

describe('DSH-styled settings rendering', () => {
  it('defaults to collapsed card with accessible toggle and no credential describe calls', () => {
    const { html, describe } = render()
    expect(html).toContain('搜索连接')
    expect(html).toContain('管理会话搜索连接、凭据引用与内容实时性偏好')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-open="false"')
    expect(html).toContain('aria-label="展开: 搜索连接"')
    expect(html).toContain('aria-controls=')
    expect(html).toContain('--dsw-alias-border-l2')
    expect(html).not.toContain('aria-expanded="true"')
    expect(html).not.toContain('class="v2s-body"')
    expect(html).not.toContain('Exa 访问方式')
    expect(html).not.toContain('宿主有效模型绑定不可用')
    expect(describe).not.toHaveBeenCalled()
  })

  it('aligns outer vertical spacing with native host container without card margin-bottom', () => {
    const { html } = render(false)
    expect(html).toContain('aria-expanded="false"')
    expect(v2CardCss).not.toContain('margin-bottom')
    expect(v2CardCss).toMatch(/\.v2s-card\s*\{[^}]*\}/)
    expect(v2CardCss).toContain('--dsw-alias-border-l2')
  })
})
