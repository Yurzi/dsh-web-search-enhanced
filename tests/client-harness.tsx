/** Shared helpers for client component specs (jsdom). */
export { tEn, tZh } from './client-t.ts'
import { act, useSyncExternalStore, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach } from 'vitest'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

declare global {
  // React reads this flag to accept act() outside a test renderer.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []
afterEach(() => {
  act(() => { for (const root of roots.splice(0)) root.unmount() })
  document.body.innerHTML = ''
})

export function render(element: ReactElement): { container: HTMLElement; rerender(next: ReactElement): void } {
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(element) })
  return { container, rerender: next => act(() => { root.render(next) }) }
}

/** The renderer's `use<Name>` binding of a hooks-compartment source. */
export function bindHook<T>(source: ObservableSnapshot<T>) {
  return <S,>(selector: (value: T) => S): S => selector(useSyncExternalStore(listener => source.subscribe(listener), () => source.getSnapshot()))
}

/** A writable observable for tests. */
export function observable<T>(initial: T): ObservableSnapshot<T> & { set(next: T): void } {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next) => { value = next; for (const listener of [...listeners]) listener() },
  }
}

/** Settle pending promises and the React updates they cause. */
export async function flush(): Promise<void> {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

export function click(element: Element | null | undefined): void {
  if (!(element instanceof HTMLElement)) throw new Error('nothing to click')
  act(() => { element.click() })
}

export function byText<E extends Element = HTMLElement>(root: ParentNode, selector: string, text: string): E | undefined {
  return [...root.querySelectorAll<E>(selector)].find(element => element.textContent?.includes(text))
}
/** Type into a controlled input the way React observes it. */
export function type(element: Element | null | undefined, value: string): void {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error('nothing to type into')
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
/** Move focus into and out of an element, as leaving a field does. */
export function blur(element: Element | null | undefined): void {
  if (!(element instanceof HTMLElement)) throw new Error('nothing to blur')
  act(() => { element.focus(); element.blur() })
}
