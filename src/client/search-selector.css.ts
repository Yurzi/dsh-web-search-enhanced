export const selectorCss = `
.v2s-selector { max-width:100%; min-width:0; font:inherit; font-size:12px; color:var(--dsw-alias-label-secondary); display:flex; flex-direction:column; gap:4px; }
.v2s-selector-control { display:inline-flex; align-items:center; gap:6px; width:fit-content; max-width:100%; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; padding:4px 8px; background:var(--dsw-alias-bg-layer-2); }
.v2s-selector-control:focus-within { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
.v2s-selector-control select { min-width:0; max-width:min(240px,100%); border:0; background:transparent; color:var(--dsw-alias-label-primary); font:inherit; cursor:pointer; }
.v2s-selector-control select:focus { outline:none; }
.v2s-selector-control option,.v2s-selector-control optgroup { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
.v2s-selector-control select:disabled { opacity:.55; cursor:default; }
.v2s-selector p { margin:2px 0; overflow-wrap:anywhere; }
.v2s-selector details { font-size:11px; }
.v2s-selector summary { cursor:pointer; }
.v2s-selector [role=alert] { color:var(--dsw-alias-state-error-primary,#dc2626); }
.v2s-selector button { font:inherit; color:var(--dsw-alias-label-primary); border:1px solid var(--dsw-alias-border-l2); border-radius:6px; background:var(--dsw-alias-bg-layer-2); padding:2px 6px; cursor:pointer; }
`
