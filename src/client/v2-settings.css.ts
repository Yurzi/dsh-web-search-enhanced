export const v2CardCss = `
/* Responsive form columns also work inside narrow settings panels. */
.v2s-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr)); gap:12px; }
/* Card container */
.v2s-card {
  list-style: none;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  transition: border-color .16s ease, background .16s ease;
  overflow: hidden;
}
.v2s-card:hover {
  border-color: var(--dsw-alias-label-dimmed);
}
.v2s-card[data-open='true'] {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-label-dimmed);
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
  border-radius: 14px;
}
.v2s-header:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
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
}
.v2s-badge {
  white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 999px;
  flex: none;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
}
.v2s-badge-busy {
  background: var(--dsw-alias-brand-primary);
  color: #fff;
  border-color: transparent;
}
.v2s-badge-notice {
  background: var(--dsw-alias-state-success-primary, #10b981);
  color: #fff;
  border-color: transparent;
}
.v2s-badge-error {
  background: var(--dsw-alias-state-error-primary, #f43f5e);
  color: #fff;
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
  border-top: 1px solid var(--dsw-alias-border-l2);
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
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}
.v2s-callout-warn {
  border-color: var(--dsw-alias-state-warn-primary, #eab308);
  background: var(--dsw-alias-bg-module-platform);
}
.v2s-callout-warn-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-state-warn-label, #ca8a04);
}

/* Form fields */
.v2s-field-group {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}
.v2s-field {
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
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  outline: none;
  transition: border-color .16s ease, background .16s ease;
}
.v2s-input, .v2s-select {
  height: 34px;
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
.v2s-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--dsw-alias-label-tertiary);
}

/* Connection Rows */
.v2s-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.v2s-row {
  flex-wrap: wrap;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
  transition: border-color .16s ease, background .16s ease;
}
.v2s-row:hover {
  border-color: var(--dsw-alias-label-dimmed);
}
.v2s-row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1 1 240px;
}
.v2s-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
.v2s-dot-configured {
  background: var(--dsw-alias-state-success-primary, #10b981);
}
.v2s-dot-missing {
  background: var(--dsw-alias-label-dimmed, #888);
}
.v2s-row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
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
  border: 1px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  flex: none;
}
.v2s-tag-warn {
  border-color: var(--dsw-alias-state-warn-primary, #eab308);
  color: var(--dsw-alias-state-warn-label, #ca8a04);
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
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

/* Buttons */
.v2s-btn {
  appearance: none;
  font: inherit;
  cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 12px;
  line-height: 1.5;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  transition: all .16s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  white-space: nowrap;
}
.v2s-btn:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-label-dimmed);
  background: var(--dsw-alias-bg-layer-4, rgba(255,255,255,0.04));
}
.v2s-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.v2s-btn:disabled {
  opacity: .4;
  cursor: default;
}
.v2s-btn-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-label-primary));
  color: var(--dsw-alias-label-primary-foreground, #fff);
  font-weight: 500;
}
.v2s-btn-primary:hover:not(:disabled) {
  opacity: .9;
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-label-primary));
}
.v2s-btn-danger {
  color: var(--dsw-alias-state-error-primary, #f43f5e);
  border-color: transparent;
}
.v2s-btn-danger:hover:not(:disabled) {
  color: var(--dsw-alias-state-error-primary, #f43f5e);
  border-color: var(--dsw-alias-state-error-primary, #f43f5e);
  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(244,63,94,0.08));
}
.v2s-btn-dashed {
  border: 1px dashed var(--dsw-alias-border-l3);
  padding: 5px 12px;
}
.v2s-btn-dashed:hover:not(:disabled) {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
}

/* Editor Panel */
.v2s-editor-panel {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-module-platform);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.v2s-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
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
  border-top: 1px solid var(--dsw-alias-border-l2);
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
  color: var(--dsw-alias-state-error-primary, #f43f5e);
}
.v2s-status-notice {
  color: var(--dsw-alias-state-success-primary, #10b981);
}
.v2s-status-info {
  color: var(--dsw-alias-label-tertiary);
}
`
