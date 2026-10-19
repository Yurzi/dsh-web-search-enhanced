/**
 * The composer's search seat (`conversation.input.right`): a ModelSelect-style
 * trigger showing the session's connection and freshness, and a menu portaled
 * to document.body with Off, the enabled search services and model searches,
 * the freshness preference, and a link to the plugin settings. Narrow composer
 * rows collapse the trigger to its icon through CSS only.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconGlobeOutlineRegular, IconSettingsOutlineRegular,
  IconWarningOutlineRegular, MenuGroup, MenuSurface, SegmentedControl, StateDot, Toast,
  useAnchoredPosition, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { FRESHNESS, type Freshness } from '../../catalog.ts'
import type { ConnectionView, SelectionView } from '../../remote-contract.ts'
import type { V2Config } from '../../settings/types.ts'
import {
  connectionLabel, freshnessLabel, modelKeyOf, notReadyReason, pickerGroups, rowCaption,
  selectionIssue, writeFailureText, type Translate,
} from '../connections.ts'
import type { LocaleKey, NS } from '../locales.ts'
import type { SelectionState, SelectionUpdate, WriteResult } from '../selection.ts'
import css from './SearchSelector.module.css'

/** Business face injected per session by the plugin's registration. */
export interface SearchSelectorInjected {
  hooks: {
    /** This session's selection, shared with /setup-search. */
    selection: ObservableSnapshot<SelectionState>
    /** Plugin settings: `showSelector` and custom connection facts. */
    settings: ConfigForm<V2Config>
    /** Link to this plugin's settings page, present while the Plugins page is. */
    navigation: ObservableSnapshot<Navigation>
  }
  /** Make the view current for the session model; cheap when it already is. */
  load: (modelKey: string) => Promise<void>
  /** Read the session again (menu open, retry). */
  refresh: () => Promise<void>
  /** Write one change against the revision the view shows. */
  select: (update: SelectionUpdate) => Promise<WriteResult>
}

export interface Navigation {
  readonly openSettings: (() => void) | undefined
}

export type SearchSelectorProps =
  PropsRuntime<'conversation.input.right'> & InjectFace<SearchSelectorInjected> & PropsLocale<typeof NS>

/** Render nothing once the accepted settings hide the seat; loading settings keep it. */
export function SearchSelector(props: SearchSelectorProps) {
  const hidden = props.useSettings(snapshot => snapshot.status === 'ready' && snapshot.value?.showSelector === false)
  return hidden ? null : <SelectorSeat {...props} />
}

const FRESHNESS_HINTS = {
  auto: 'selector.freshnessHint.auto', fresh: 'selector.freshnessHint.fresh', realtime: 'selector.freshnessHint.realtime',
} as const satisfies Record<Freshness, LocaleKey>

const FRESHNESS_SEGMENTS = {
  auto: 'freshness.auto', fresh: 'freshness.short.fresh', realtime: 'freshness.short.realtime',
} as const satisfies Record<Freshness, LocaleKey>

const ROW_SELECTOR = '[role="menuitemradio"]:not(:disabled), [role="menuitem"]:not(:disabled)'

function SelectorSeat({
  useSelection, useSettings, useNavigation, useProjection, useAccess, load, refresh, select, t,
}: SearchSelectorProps) {
  const state = useSelection(snapshot => snapshot)
  const openSettings = useNavigation(navigation => navigation.openSettings)
  const config = useSettings(snapshot => snapshot.value)
  const modelKey = useProjection('modelSelection', modelKeyOf)
  const writable = useAccess('searchConnections/set')
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<{ seq: number; text: string } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const id = useId()
  const position = useAnchoredPosition({ open, anchorRef: triggerRef, panelRef: menuRef, side: 'top', align: 'end', gap: 8, margin: 12 })
  useDismissOnOutsidePointer(rootRef, open, setOpen, menuRef)

  // A model switch re-evaluates the session's default connection on the Host.
  useEffect(() => { void load(modelKey) }, [load, modelKey])

  // Once placed (a hidden menu cannot take focus), opening lands on the row in use.
  const placed = open && position !== null
  useEffect(() => {
    if (!placed) return
    const rows = menuRef.current?.querySelectorAll<HTMLElement>(ROW_SELECTOR)
    const checked = menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not(:disabled)')
    ;(checked ?? rows?.[0])?.focus()
  }, [placed])

  const { view } = state
  const close = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const announce = (result: WriteResult): boolean => {
    if (!result.ok) setNotice({ seq: (notice?.seq ?? 0) + 1, text: writeFailureText(result.error, t) })
    return result.ok
  }
  const choose = async (connectionId: string | null): Promise<void> => {
    if (connectionId === view?.selection.connectionId) return close()
    // Rows are disabled while the write is pending; the trigger keeps the keyboard.
    triggerRef.current?.focus()
    if (announce(await select({ connectionId }))) setOpen(false)
  }
  const changeFreshness = async (freshness: Freshness): Promise<void> => {
    if (!state.saving) announce(await select({ freshness }))
  }
  const goToSettings = openSettings === undefined ? undefined : () => {
    setOpen(false)
    openSettings()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!open || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    const target = event.target as HTMLElement
    const onRow = target === triggerRef.current || target.matches(ROW_SELECTOR)
    if (!onRow || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const rows = [...(menuRef.current?.querySelectorAll<HTMLElement>(ROW_SELECTOR) ?? [])]
    const index = rows.indexOf(target)
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? rows.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : index === -1 ? 0 : -1) + rows.length) % rows.length
    rows[next]?.focus()
  }

  const trigger = triggerFace(state, config, t)
  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={trigger.aria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-busy={state.saving}
        title={trigger.title}
        onClick={() => {
          if (open) return close()
          setOpen(true)
          void refresh()
        }}
      >
        <IconGlobeOutlineRegular className={css.icon} size={16} />
        <span className={css.label}>{trigger.label}</span>
        {trigger.caption === undefined ? null : <span className={css.triggerCaption}>{trigger.caption}</span>}
        {trigger.attention ? <StateDot state="warning" className={css.attention} /> : null}
        {state.saving
          ? <StateDot state="ongoing" className={css.busy} />
          : <IconChevronDownOutlineRegular className={clsx(css.chevron, open && css.chevronOpen)} />}
      </button>
      {open && createPortal(
        <MenuSurface
          ref={menuRef}
          id={`${id}-menu`}
          className={css.menu}
          style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
          role="group"
          aria-label={t('selector.menu')}
          aria-busy={state.saving}
        >
          {view === undefined
            ? <LoadState state={state} refresh={refresh} t={t} />
            : <MenuBody
                view={view} config={config} writable={writable} state={state} goToSettings={goToSettings}
                refresh={refresh} choose={choose} changeFreshness={changeFreshness} t={t}
              />}
          {goToSettings === undefined ? null : (
            <div className={css.footer}>
              <button type="button" role="menuitem" className={css.manage} onClick={goToSettings}>
                <IconSettingsOutlineRegular size={16} />
                <span>{t('selector.manage')}</span>
              </button>
            </div>
          )}
        </MenuSurface>,
        document.body,
      )}
      {notice === null ? null : (
        <Toast
          key={notice.seq}
          text={notice.text}
          icon={<IconWarningOutlineRegular />}
          holdMs={4000}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setNotice(null) }}
        />
      )}
    </div>
  )
}

interface TriggerFace {
  readonly label: string
  readonly caption: string | undefined
  readonly aria: string
  readonly title: string
  readonly attention: boolean
}

function triggerFace(state: SelectionState, config: V2Config | undefined, t: Translate): TriggerFace {
  const { view } = state
  if (view === undefined) {
    const title = state.readFailed ? t('selector.readFailed') : t('selector.loading')
    return { label: t('selector.loading'), caption: undefined, aria: title, title, attention: state.readFailed }
  }
  const { connectionId, freshness } = view.selection
  const selected = view.connections.find(connection => connection.id === connectionId)
  const name = connectionId === null ? t('connection.off') : selected === undefined ? connectionId : connectionLabel(selected, t)
  const issue = selectionIssue(view)
  const reason = issue === undefined ? undefined
    : issue.kind === 'missing' ? t('status.missing') : notReadyReason(issue.connection, config, t)
  const caption = connectionId === null || freshness === 'auto' ? undefined : t(freshness === 'fresh' ? 'freshness.short.fresh' : 'freshness.short.realtime')
  const aria = caption === undefined
    ? t('selector.aria', { name })
    : t('selector.ariaFreshness', { name, freshness: freshnessLabel(freshness, t) })
  return { label: name, caption, aria, title: reason ?? aria, attention: reason !== undefined || state.readFailed }
}

function LoadState({ state, refresh, t }: { state: SelectionState; refresh: () => Promise<void>; t: Translate }) {
  return state.readFailed
    ? <ReadError refresh={refresh} t={t} />
    : <p className={css.status} role="status"><StateDot state="ongoing" />{t('selector.loading')}</p>
}

/** The whole strip retries: its text says so. */
function ReadError({ refresh, t }: { refresh: () => Promise<void>; t: Translate }) {
  return (
    <div role="alert">
      <button type="button" className={css.error} onClick={() => { void refresh() }}>{t('selector.readFailed')}</button>
    </div>
  )
}

interface MenuBodyProps {
  view: SelectionView
  config: V2Config | undefined
  state: SelectionState
  writable: boolean
  refresh: () => Promise<void>
  choose: (connectionId: string | null) => Promise<void>
  changeFreshness: (freshness: Freshness) => Promise<void>
  /** Close the menu and open the plugin settings; absent without the Plugins page. */
  goToSettings: (() => void) | undefined
  t: Translate
}

function MenuBody({ view, config, state, writable, refresh, choose, changeFreshness, goToSettings, t }: MenuBodyProps) {
  const id = useId()
  const { connectionId, freshness } = view.selection
  const groups = pickerGroups(view)
  const issue = selectionIssue(view)
  const selected = view.connections.find(connection => connection.id === connectionId)
  const locked = !writable || state.saving
  const row = (connection: ConnectionView) => (
    <ConnectionRow
      key={connection.id} connection={connection} selected={connection.id === connectionId} locked={locked}
      onChoose={() => { void choose(connection.id) }} goToSettings={goToSettings} t={t}
    />
  )
  return (
    <>
      {state.readFailed ? <ReadError refresh={refresh} t={t} /> : null}
      {issue === undefined ? null : (
        <div className={css.warning} role="status">
          <IconWarningOutlineRegular className={css.warningIcon} size={16} />
          <span className={css.warningText}>
            {issue.kind === 'missing' ? t('status.missing') : notReadyReason(issue.connection, config, t)}
            {issue.kind === 'not-ready' && issue.connection.detail !== undefined
              ? <span className={css.detail}>{issue.connection.detail}</span>
              : null}
          </span>
          {goToSettings === undefined ? null : (
            <button type="button" className={css.warningAction} onClick={goToSettings}>{t('selector.openSettings')}</button>
          )}
        </div>
      )}
      <div className={css.rows} role="menu" aria-label={t('selector.menu')}>
        <button
          type="button" role="menuitemradio" aria-checked={connectionId === null} className={css.option}
          disabled={locked} onClick={() => { void choose(null) }}
        >
          <span className={css.optionLabel}>{t('selector.offRow')}</span>
          <span className={css.check}>{connectionId === null ? <IconCheckOutlineRegular /> : null}</span>
        </button>
        <div className={css.separator} role="separator" />
        {groups.services.length === 0 ? null : <MenuGroup label={t('selector.services')}>{groups.services.map(row)}</MenuGroup>}
        {groups.models.length === 0 ? null : <MenuGroup label={t('selector.models')}>{groups.models.map(row)}</MenuGroup>}
        {groups.services.length + groups.models.length === 0 ? <p className={css.status}>{t('selector.empty')}</p> : null}
      </div>
      <div className={css.freshness}>
        <span className={css.sectionLabel} id={`${id}-freshness`}>{t('selector.freshness')}</span>
        <SegmentedControl
          id={`${id}-freshness-mode`}
          className={css.segments}
          value={freshness}
          label={t('selector.freshness')}
          options={FRESHNESS.map(mode => ({ value: mode, label: t(FRESHNESS_SEGMENTS[mode]) }))}
          disabled={!writable || selected?.freshness !== true}
          onChange={(mode) => { void changeFreshness(mode) }}
        />
        <p className={css.hint}>
          {selected === undefined ? t('selector.freshnessOff')
            : selected.freshness ? t(FRESHNESS_HINTS[freshness])
              : t('selector.freshnessIgnored', { name: connectionLabel(selected, t) })}
        </p>
      </div>
      {writable ? null : <p className={css.hint}>{t('selector.readOnly')}</p>}
    </>
  )
}

/**
 * One connection. A ready row selects it; a row that needs setup leads to the
 * plugin settings when the Plugins page is there, and is inert otherwise.
 */
function ConnectionRow({ connection, selected, locked, onChoose, goToSettings, t }: {
  connection: ConnectionView
  selected: boolean
  locked: boolean
  onChoose: () => void
  goToSettings: (() => void) | undefined
  t: Translate
}) {
  const label = connectionLabel(connection, t)
  const caption = rowCaption(connection, t)
  const ready = connection.status === 'ready'
  const setup = !ready && goToSettings !== undefined
  return (
    <button
      type="button" role="menuitemradio" aria-checked={selected} className={css.option}
      disabled={ready ? locked : !setup} title={label}
      aria-label={setup ? t('selector.rowToSettings', { name: label, reason: caption }) : undefined}
      onClick={setup ? goToSettings : onChoose}
    >
      <span className={css.optionLabel}>{label}</span>
      {caption === undefined ? null : <span className={clsx(css.caption, !ready && css.captionWarn)}>{caption}</span>}
      <span className={css.check}>{selected ? <IconCheckOutlineRegular /> : null}</span>
    </button>
  )
}
