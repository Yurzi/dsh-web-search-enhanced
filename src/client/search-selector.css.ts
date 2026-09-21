export const selectorCss = `
/* Match DSH ModelSelect trigger/menu metrics and semantic theme tokens. */
.v2s-selector { display:inline-flex; align-items:center; flex:none; min-width:0; font:inherit; }
.v2s-search-trigger { display:flex; align-items:center; gap:4px; min-width:0; max-width:min(280px,45cqw); height:28px; padding:0 4px 0 8px; border:none; border-radius:24px; outline:none; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:13px; font-weight:500; line-height:20px; cursor:pointer; white-space:nowrap; }
.v2s-search-trigger:hover,.v2s-search-trigger[aria-expanded=true] { background:var(--dsw-alias-interactive-bg-hover); }
.v2s-search-trigger:focus-visible { box-shadow:0 0 0 2px var(--dsw-alias-border-l3); }
.v2s-search-trigger svg { flex:none; }
.v2s-search-label,.v2s-search-mode { min-width:0; overflow:hidden; text-overflow:ellipsis; }
.v2s-search-mode { flex-shrink:1000; color:var(--dsw-alias-label-caption); }
.v2s-search-chevron { color:var(--dsw-alias-label-caption); transition:transform .12s; }
.v2s-search-trigger[aria-expanded=true] .v2s-search-chevron { transform:rotate(180deg); }
.v2s-search-check { color:var(--dsw-alias-state-success-primary,#16834a); }
.v2s-search-error-dot { color:var(--dsw-alias-state-error-primary); font-weight:700; }
.v2s-search-busy { animation:v2s-search-pulse 1s ease-in-out infinite alternate; }
@keyframes v2s-search-pulse { to { opacity:.35; } }
@media(prefers-reduced-motion:reduce) { .v2s-search-busy { animation:none; } }
@container(width<=420px) { .v2s-search-mode { display:none; } }
@container(width<=360px) { .v2s-search-label { display:none; } }
.v2s-search-sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0; }
.v2s-selector-panel { position:fixed; inset:auto; margin:0; box-sizing:border-box; max-width:calc(100vw - 32px); padding:4px; overflow:auto; border:0; border-radius:20px; background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-3)); color:var(--dsw-alias-label-primary); --dsw-elevation-stroke-color:var(--dsw-alias-border-l1); box-shadow:var(--dsw-elevation-prominent,0 8px 32px #0002); font-family:inherit; font-size:13px; line-height:20px; }
.v2s-selector-panel:not(:popover-open) { display:none; }
.v2s-selector-panel::backdrop { background:transparent; }
.v2s-search-group-title { padding:5px 8px 3px; font-size:12px; font-weight:500; line-height:18px; color:var(--dsw-alias-label-tertiary); }
.v2s-search-option { box-sizing:border-box; width:100%; min-height:38px; display:flex; align-items:center; gap:8px; padding:6px 8px; color:inherit; background:transparent; border:none; border-radius:10px; outline:none; text-align:left; font:inherit; font-size:14px; font-weight:400; line-height:20px; cursor:pointer; }
.v2s-search-option>span:first-child { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.v2s-search-option:hover:not(:disabled),.v2s-search-option:focus-visible { background:var(--dsw-alias-interactive-bg-hover); }
.v2s-search-option:disabled { color:var(--dsw-alias-label-dimmed); cursor:default; }
.v2s-search-option-check { flex:0 0 18px; display:grid; place-items:center; }
.v2s-search-freshness { margin:5px 4px 4px; padding-top:6px; border-top:1px solid var(--dsw-alias-border-l2); }
.v2s-search-segments { display:flex; gap:2px; padding:3px; margin:4px; border:1px solid var(--dsw-alias-border-l2); border-radius:10px; }
.v2s-search-segments button { flex:1; min-width:0; padding:5px 2px; border:0; border-radius:7px; color:var(--dsw-alias-label-secondary); background:transparent; font:inherit; font-size:12px; white-space:nowrap; cursor:pointer; }
.v2s-search-segments button[aria-pressed=true] { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); font-weight:500; }
.v2s-search-segments button:focus-visible { outline:2px solid var(--dsw-alias-border-l3); outline-offset:-2px; }
.v2s-search-segments button:disabled { opacity:.5; cursor:default; }
.v2s-search-error { display:flex; gap:8px; justify-content:space-between; margin:4px; padding:7px 8px; border-radius:8px; color:var(--dsw-alias-state-error-primary); background:var(--dsw-alias-interactive-bg-hover-danger); font-size:12px; line-height:18px; overflow-wrap:anywhere; }
.v2s-search-error button { flex:none; padding:0; border:0; color:inherit; background:transparent; font:inherit; font-weight:600; cursor:pointer; }
`;
