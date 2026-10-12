/**
 * L2.5: once the label is hidden, drop the chevron and keep a native 28px icon
 * seat; transient status marks become corner badges instead of widening it.
 */
const iconOnly = (scope: string) => `${scope}.v2s-search-label,${scope}.v2s-search-mode,${scope}.v2s-search-chevron { display:none; }
${scope}.v2s-search-trigger { justify-content:center; gap:0; width:28px; padding:0; }
${scope}.v2s-search-check,${scope}.v2s-search-error-dot { position:absolute; top:1px; right:1px; font-size:10px; line-height:10px; pointer-events:none; }`

export const selectorCss = `
/* Match DSH ModelSelect trigger/menu metrics and semantic theme tokens. */
.v2s-selector { display:inline-flex; align-items:center; flex:none; min-width:0; font:inherit; }
/* L3: the crowded-row observer yields this seat before DSH's control row wraps. */
.v2s-selector[hidden] { display:none; }
.v2s-search-trigger { position:relative; display:flex; align-items:center; gap:4px; min-width:0; max-width:220px; max-width:min(360px,45cqw); height:28px; padding:0 4px 0 8px; border:none; border-radius:24px; outline:none; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:13px; font-weight:500; line-height:20px; cursor:pointer; white-space:nowrap; }
.v2s-search-trigger:hover,.v2s-search-trigger[aria-expanded=true] { background:var(--dsw-alias-interactive-bg-hover); }
.v2s-search-trigger:focus-visible { box-shadow:0 0 0 2px var(--dsw-alias-border-l3); }
.v2s-search-trigger svg { flex:none; }
/* Text stays on one line even when a host layout re-enables wrapping on buttons. */
.v2s-search-label,.v2s-search-mode { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.v2s-search-mode { flex-shrink:1000; color:var(--dsw-alias-label-caption); }
.v2s-search-chevron { color:var(--dsw-alias-label-caption); transition:transform .12s; }
.v2s-search-trigger[aria-expanded=true] .v2s-search-chevron { transform:rotate(180deg); }
.v2s-search-check { color:var(--dsw-alias-state-success-primary); }
.v2s-search-error-dot { color:var(--dsw-alias-state-error-primary); font-weight:700; }
.v2s-search-busy { animation:v2s-search-pulse 1s ease-in-out infinite alternate; }
@keyframes v2s-search-pulse { to { opacity:.35; } }
@media(prefers-reduced-motion:reduce) { .v2s-search-busy { animation:none; } .v2s-search-chevron { transition:none; } }
/* Match DSH conversation.input.model content-driven collapse via row variables on desktop. */
.v2s-search-label,.v2s-search-mode { display:var(--dsh-composer-model-text-display,block); }
${iconOnly(':where([data-model-compact]) ')}
/* Responsive auto-scaling for narrow containers and mobile viewports. */
@container(width<=420px) { .v2s-search-mode { display:none; } }
@container(width<=360px) { ${iconOnly('')} }
@media (max-width:420px) { .v2s-search-mode { display:none; } }
@media (max-width:360px) { ${iconOnly('')} }
/* dsh-mobile >=0.6.3 keeps DSH's flex groups: controls wrap inside
   [data-dsh-mobile-composer-controls], and it owns touch-target sizing and the
   wrapper's min/max width. Only cap the trigger; L3 still yields the seat
   before the row wraps, with /setup-search as the entry point. */
:where([data-dsh-mobile-composer-row]) .v2s-selector { flex:0 1 auto; }
:where([data-dsh-mobile-composer-row]) .v2s-search-trigger { max-width:min(100%,180px); }
:where([data-dsh-mobile-composer-row]) .v2s-search-mode { display:none; }
.v2s-search-sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0; }
.v2s-selector-panel { position:fixed; inset:auto; margin:0; box-sizing:border-box; max-width:calc(100vw - 32px); padding:3px; overflow:auto; overscroll-behavior:contain; border:0; border-radius:16px; background:var(--dsw-specific-menu); backdrop-filter:var(--dsw-menu-backdrop-filter); color:var(--dsw-alias-label-primary); --dsw-elevation-stroke-color:var(--dsw-alias-border-l1); box-shadow:var(--dsw-elevation-prominent); --dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2); font-family:inherit; font-size:13px; line-height:20px; }
.v2s-selector-panel:not(:popover-open) { display:none; }
.v2s-selector-panel::backdrop { background:transparent; }
.v2s-search-group-title { padding:4px 7px 2px; font-size:11px; font-weight:500; line-height:16px; color:var(--dsw-alias-label-tertiary); }
.v2s-search-option { box-sizing:border-box; width:100%; min-height:34px; display:flex; align-items:center; gap:6px; padding:5px 7px; color:inherit; background:transparent; border:none; border-radius:8px; outline:none; text-align:left; font:inherit; font-size:13px; font-weight:500; line-height:18px; cursor:pointer; }
.v2s-search-option>span:first-child { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.v2s-search-option:hover:not(:disabled),.v2s-search-option:focus-visible { background:var(--dsw-alias-interactive-bg-hover); }
.v2s-search-option:disabled { color:var(--dsw-alias-label-dimmed); cursor:default; }
.v2s-search-option-check { flex:0 0 18px; display:grid; place-items:center; }
.v2s-search-freshness { margin:5px 4px 4px; padding-top:6px; border-top:1px solid var(--dsw-alias-border-l2); }
.v2s-search-segments { display:flex; gap:2px; padding:3px; margin:4px; border:0.5px solid var(--dsw-alias-border-l2); border-radius:10px; background:var(--dsw-alias-bg-module-platform); }
.v2s-search-segments button { flex:1; min-width:0; padding:5px 2px; border:0; border-radius:7px; color:var(--dsw-alias-label-secondary); background:transparent; font:inherit; font-size:12px; white-space:nowrap; cursor:pointer; }
.v2s-search-segments button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.v2s-search-segments button[aria-pressed=true] { background:var(--dsw-alias-button-elevated-fill); color:var(--dsw-alias-label-primary); font-weight:500; }
.v2s-search-segments button:focus-visible { outline:2px solid var(--dsw-alias-border-l3); outline-offset:-2px; }
.v2s-search-segments button:disabled { opacity:.5; cursor:default; }
.v2s-search-error { display:flex; gap:8px; justify-content:space-between; margin:4px; padding:7px 8px; border-radius:8px; color:var(--dsw-alias-state-error-primary); background:var(--dsw-alias-interactive-bg-hover-danger); font-size:12px; line-height:18px; overflow-wrap:anywhere; }
.v2s-search-error button { flex:none; padding:0; border:0; color:inherit; background:transparent; font:inherit; font-weight:600; cursor:pointer; }
`;
