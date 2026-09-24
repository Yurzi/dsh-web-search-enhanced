import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { V2Settings, type V2SettingsProps } from '../src/client/V2Settings.tsx'
import { v2CardCss } from '../src/client/v2-settings.css.ts'
import { en, zh, type LocaleKey } from '../src/client/locales.ts'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { V2Config } from '../src/config.ts'

function propsFor(scope: { getSnapshot: () => unknown }, describe: V2SettingsProps['describeCredentials']): V2SettingsProps {
  return {
    useSettings: selector => selector(scope.getSnapshot() as ConfigFormSnapshot<V2Config>),
    mutateSettings: vi.fn(async () => true), describeCredentials: describe,
    setCredential: vi.fn(), t: key => zh[key as LocaleKey] ?? key,
  }
}

function render(writable = true) {
  const describe = vi.fn()
  const scope = { subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready', writable, revision: 1, value: { version: 2, defaultConnection: 'builtin:exa' } }) }
  const html = renderToStaticMarkup(createElement(V2Settings, propsFor(scope, describe)))
  return { html, describe }
}

describe('DSH-styled settings rendering', () => {
  it('reads the renderer-bound settings hook and uses localized card chrome', () => {
    const props = propsFor({ getSnapshot: () => ({ status: 'ready', writable: true, revision: 1, value: {} }) }, vi.fn())
    props.t = key => en[key as LocaleKey] ?? key
    const html = renderToStaticMarkup(createElement(V2Settings, props))
    expect(html).toContain('Manage session search connections')
    expect(html).toContain('Expand: Web Search Enhanced')
    expect(html).not.toContain('管理会话')
  })
  it('does not render a form for an unavailable settings namespace', () => {
    const props = propsFor({ getSnapshot: () => ({ status: 'unavailable', writable: false }) }, vi.fn())
    expect(renderToStaticMarkup(createElement(V2Settings, props))).toBe('')
  })
  it('defaults to collapsed card with accessible toggle and no credential describe calls', () => {
    const { html, describe } = render()
    expect(html).toContain('<span class="v2s-title">Web Search Enhanced</span>')
    expect(html).toContain('管理会话搜索连接、凭据引用与内容实时性偏好')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-open="false"')
    expect(html).toContain('aria-label="展开: Web Search Enhanced"')
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

  it('renders connection row groups for inline expansion and includes inline key styles', () => {
    const describe = vi.fn()
    const scope = { subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready', writable: true, revision: 1, value: { version: 2, defaultConnection: 'builtin:exa' } }) }
    const html = renderToStaticMarkup(createElement(V2Settings, { ...propsFor(scope, describe), defaultOpen: true }))

    expect(html).toContain('class="v2s-row-group')
    expect(html).toContain('aria-expanded="false"')
    expect(v2CardCss).toContain('.v2s-row-group')
    expect(v2CardCss).toContain('.v2s-row-open')
    expect(v2CardCss).toContain('.v2s-inline-key-panel')
    expect(v2CardCss).toContain('.v2s-inline-key-input-row')
  })

  it('renders OpenAlex polite mailto button and configuration status', () => {
    const describe = vi.fn()
    const scope = {
      subscribe: () => () => {},
      getSnapshot: () => ({
        status: 'ready',
        writable: true,
        revision: 1,
        value: {
          version: 2,
          connections: {
            'builtin:openalex': { options: { mailto: 'user@example.edu' } },
          },
        },
      }),
    }
    const html = renderToStaticMarkup(createElement(V2Settings, { ...propsFor(scope, describe), defaultOpen: true }))
    expect(html).toContain('礼貌邮箱')
    expect(html).toContain('user@example.edu')
    expect(html).toContain('管理邮箱')
  })
  it('renders custom connection editing controls without duplicating shared credential references', () => {
    const describe = vi.fn()
    const scope = {
      subscribe: () => () => {},
      getSnapshot: () => ({
        status: 'ready', writable: true, revision: 1,
        value: { version: 2, connections: {
          'custom:one': { label: 'One', kind: 'structured', adapter: 'exa', credentialRef: 'SHARED_KEY' },
          'custom:two': { label: 'Two', kind: 'structured', adapter: 'exa', credentialRef: 'SHARED_KEY' },
        } },
      }),
    }
    const html = renderToStaticMarkup(createElement(V2Settings, { ...propsFor(scope, describe), defaultOpen: true }))
    expect(html.match(/凭据引用: <code>SHARED_KEY<\/code>/g)).toHaveLength(2)
    expect(html.match(/管理 Key/g)).toHaveLength(2)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('编辑')
  })
})
