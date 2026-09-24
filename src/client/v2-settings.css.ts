export const v2CardCss = `
/* Responsive form columns also work inside narrow settings panels. */
.v2s-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr)); gap:12px; }
/* Keep the expandable layout; use DSH 0.1.7 surfaces and compact controls. */
.v2s-card {
  list-style: none;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  transition: border-color .16s ease, background .16s ease;
  overflow: hidden;
}
.v2s-card:hover {
  border-color: var(--dsw-alias-border-l3);
}
.v2s-card[data-open='true'] {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-border-l4);
}

/* Card header button */
.v2s-header {
  width: 100%;
  appearance: none;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
}
.v2s-header:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: -2px;
}
.v2s-head-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.v2s-title {
  color: var(--dsw-alias-label-primary);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  display: flex;
  align-items: center;
  gap: 8px;
}
.v2s-desc {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 1.4;
}
.v2s-header-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 45%;
}
.v2s-badge {
  white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 999px;
  flex: none;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
}
.v2s-badge-busy {
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  border-color: transparent;
}
.v2s-badge-notice {
  background: var(--dsw-alias-state-success-tertiary);
  color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 65%, var(--dsw-alias-label-primary));
  border-color: transparent;
}
.v2s-badge-error {
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
  border-color: transparent;
}
.v2s-chevron {
  box-sizing: border-box;
  flex: none;
  width: 8px;
  height: 8px;
  margin-right: 3px;
  border-right: 1.5px solid var(--dsw-alias-label-tertiary);
  border-bottom: 1.5px solid var(--dsw-alias-label-tertiary);
  transform: rotate(45deg);
  transition: transform .16s ease;
}
.v2s-card[data-open='true'] .v2s-chevron {
  transform: rotate(225deg);
}

/* Card body */
.v2s-body {
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  margin: 0 16px;
  padding: 16px 0 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Section grouping */
.v2s-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.v2s-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.v2s-section-title {
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.v2s-section-desc {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
}
.v2s-divider {
  height: 1px;
  background: var(--dsw-alias-border-l2);
  margin: 2px 0;
}

/* Callout / Banner */
.v2s-callout {
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 12px;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--dsw-alias-bg-module-platform);
  border: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}
.v2s-callout-warn {
  border-color: var(--dsw-alias-state-warn-primary);
  background: var(--dsw-alias-bg-module-platform);
}
.v2s-callout-warn-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-state-warn-label);
}

/* Form fields */
.v2s-field-group {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: 12px;
}
.v2s-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.v2s-label {
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.v2s-input, .v2s-select, .v2s-textarea {
  box-sizing: border-box;
  width: 100%;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  outline: none;
  transition: border-color .16s ease, background .16s ease;
}
.v2s-input, .v2s-select {
  height: 32px;
  padding: 0 10px;
}
.v2s-textarea {
  padding: 8px 12px;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
}
.v2s-input:focus, .v2s-select:focus, .v2s-textarea:focus {
  border-color: var(--dsw-alias-brand-primary);
  outline: none;
}
.v2s-input:disabled, .v2s-select:disabled, .v2s-textarea:disabled {
  opacity: .55;
  cursor: default;
  color: var(--dsw-alias-label-tertiary);
}
.v2s-input::placeholder, .v2s-textarea::placeholder {
  color: var(--dsw-alias-label-dimmed);
}
.v2s-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--dsw-alias-label-tertiary);
}

/* Connection Rows & Inline Expansion */
.v2s-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.v2s-row-group {
  display: flex;
  flex-direction: column;
  border-radius: 8px;
}
.v2s-row {
  flex-wrap: wrap;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
  transition: border-color .16s ease, background .16s ease;
}
.v2s-row:hover {
  border-color: var(--dsw-alias-border-l4);
}
.v2s-row-open {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  border-bottom-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
/* Inline Key Panel */
.v2s-inline-key-panel {
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-top: none;
  border-bottom-left-radius: 8px;
  border-bottom-right-radius: 8px;
  background: var(--dsw-alias-bg-module-platform);
  padding: 10px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: v2s-slide-down .16s ease-out;
}
@keyframes v2s-slide-down {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.v2s-inline-key-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.v2s-inline-key-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  flex-wrap: wrap;
}
.v2s-inline-key-title code {
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
  background: var(--dsw-alias-bg-layer-3);
  padding: 1px 5px;
  border-radius: 4px;
  border: 0.5px solid var(--dsw-alias-border-l3);
}
.v2s-inline-key-sub {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.v2s-inline-key-icon {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}
.v2s-inline-key-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.v2s-inline-key-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.v2s-inline-key-input {
  flex: 1 1 200px;
  min-width: 0;
}
.v2s-inline-key-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.v2s-row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1 1 220px;
}
.v2s-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
.v2s-dot-configured {
  background: var(--dsw-alias-state-success-primary);
}
.v2s-dot-missing {
  background: var(--dsw-alias-label-dimmed);
}
.v2s-row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.v2s-row-title-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.v2s-row-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.v2s-tag {
  font-size: 11px;
  line-height: 16px;
  padding: 0 6px;
  border-radius: 4px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  flex: none;
}
.v2s-tag-success {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, transparent);
  background: var(--dsw-alias-state-success-tertiary);
  color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 65%, var(--dsw-alias-label-primary));
}
.v2s-tag-warn {
  border-color: var(--dsw-alias-state-warn-primary);
  color: var(--dsw-alias-state-warn-label);
}
.v2s-row-meta {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.v2s-row-meta code {
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
}
.v2s-row-actions {
  flex-wrap: wrap;
  max-width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

.v2s-row-actions .v2s-select {
  width: auto;
  max-width: 100%;
}

/* Compact capsule buttons match the host Button sm variant. */
.v2s-btn {
  appearance: none;
  box-sizing: border-box;
  font: inherit;
  cursor: pointer;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 14px;
  min-height: 28px;
  padding: 4px 10px;
  font-size: 12px;
  line-height: 18px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  transition: color .16s ease, border-color .16s ease, background .16s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  white-space: nowrap;
}
.v2s-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.v2s-btn:active:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active);
}
.v2s-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.v2s-btn:disabled {
  opacity: .4;
  cursor: not-allowed;
}
.v2s-btn-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  font-weight: 500;
}
.v2s-btn-primary:hover:not(:disabled), .v2s-btn-primary:active:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
}
.v2s-btn-active {
  background: var(--dsw-alias-button-ghost-active-fill);
  border-color: var(--dsw-alias-button-ghost-active-border);
}
.v2s-btn-active:hover:not(:disabled), .v2s-btn-active:active:not(:disabled) {
  background: var(--dsw-alias-button-ghost-active-hover);
}
.v2s-btn-danger {
  color: var(--dsw-alias-state-error-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);
}
.v2s-btn-danger:hover:not(:disabled), .v2s-btn-danger:active:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger);
}
.v2s-btn-dashed {
  border-style: dashed;
}

/* Editor Panel */
.v2s-editor-panel {
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-module-platform);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.v2s-row-group > .v2s-editor-panel {
  border-top: none;
  border-radius: 0 0 8px 8px;
}
.v2s-row-group > .v2s-inline-key-panel,
.v2s-row-group > .v2s-editor-panel {
  min-width: 0;
  animation: v2s-slide-down .16s ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .v2s-row-group > .v2s-inline-key-panel,
  .v2s-row-group > .v2s-editor-panel { animation: none; }
  .v2s-card, .v2s-card * { transition: none; }
}
.v2s-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.v2s-editor-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.v2s-editor-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

/* Checkbox */
.v2s-checkbox-label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.v2s-checkbox-label input[type='checkbox'] {
  accent-color: var(--dsw-alias-brand-primary);
  margin-top: 2px;
  flex: none;
  cursor: pointer;
}

/* Footer / Status Area */
.v2s-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 8px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.v2s-footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.v2s-status-area {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}
.v2s-status-text {
  font-size: 12px;
  line-height: 1.4;
  margin: 0;
}
.v2s-status-error {
  color: var(--dsw-alias-state-error-primary);
}
.v2s-status-notice {
  color: var(--dsw-alias-state-success-primary);
}
.v2s-status-info {
  color: var(--dsw-alias-label-tertiary);
}
`
