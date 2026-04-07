import { DOCUMINT_LEAF_TOOLBAR_STYLES } from "./toolbar/styles";

// Shared leaf portal and leaf content styles. This module keeps overlay chrome
// and leaf-specific layout together so the host stylesheet can stay focused on
// the editor surface itself.
export const DOCUMINT_LEAF_STYLES = `
:where(.documint-leaf-shell) {
  --documint-leaf-divider-color:
    color-mix(in srgb, var(--documint-leaf-border) 60%, transparent);
  --documint-leaf-shadow-fallback:
    0 14px 40px color-mix(in srgb, var(--documint-leaf-text) 16%, transparent);
  padding: 0.8rem;
  border: 1px solid var(--documint-leaf-border);
  border-radius: 0.95rem;
  background: var(--documint-leaf-bg);
  box-shadow: var(--documint-leaf-shadow, var(--documint-leaf-shadow-fallback));
  color: var(--documint-leaf-text);
  font-family: "Avenir Next", "Segoe UI", sans-serif;
  font-size: 0.84rem;
  line-height: 1.45;
  pointer-events: auto;
}

:where(.documint-leaf-shell:has(> .documint-leaf-toolbar)),
:where(.documint-leaf-shell:has(> .documint-comment-popover-create)) {
  width: auto;
  padding: 0.38rem 0.58rem;
}

:where(.documint-leaf-shell:has(> .documint-comment-popover-create.is-expanded)) {
  padding: 0.8rem;
}

:where(.documint-leaf-shell[data-status="resolved"]) {
  border-color: var(--documint-leaf-resolved-border);
  background: var(--documint-leaf-resolved-bg);
}

:where(.documint-leaf-shell p) {
  margin: 0;
}

:where(.documint-comment-popover:not(.documint-comment-popover-create)),
:where(.documint-comment-popover-create.is-expanded) {
  width: var(--documint-leaf-width, min(18rem, calc(100vw - 4rem)));
}

:where(.documint-link-popover) {
  width: min(16rem, calc(100vw - 4rem));
}

${DOCUMINT_LEAF_TOOLBAR_STYLES}

:where(.documint-leaf-anchor) {
  --documint-leaf-anchor-bridge-height: 12px;
  position: fixed;
  z-index: 1000;
  padding-top: var(--documint-leaf-anchor-bridge-height);
  margin-top: calc(var(--documint-leaf-anchor-bridge-height) * -1);
  pointer-events: auto;
}

:where(.documint-leaf-anchor[data-selection="true"]) {
  --documint-leaf-anchor-bridge-height: 0px;
  padding-top: 0;
  margin-top: 14px;
  pointer-events: none;
}

:where(.documint-leaf-bridge) {
  width: 100%;
  height: var(--documint-leaf-anchor-bridge-height);
}

:where(.documint-link-popover) {
  display: grid;
  gap: 0.3rem;
  min-width: 0;
}

:where(.documint-link-popover-row) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: flex-start;
  gap: 0.6rem;
}

:where(.documint-link-popover-row.is-editing) {
  grid-template-columns: minmax(0, 1fr);
}

:where(.documint-link-popover-actions) {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

:where(.documint-link-popover-divider) {
  margin: 0.2rem 0;
  border-top: 1px solid var(--documint-leaf-divider-color);
}

:where(.documint-link-popover-hint) {
  color: var(--documint-leaf-secondary-text);
  font-size: 0.74rem;
  font-style: italic;
}

:where(.documint-link-popover-title) {
  color: var(--documint-leaf-text);
  font-size: 0.78rem;
  font-weight: 600;
}

:where(.documint-link-popover-url) {
  min-width: 0;
  color: var(--documint-leaf-secondary-text);
  font-size: 0.76rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

:where(.documint-link-popover-input) {
  min-height: auto;
  padding-right: 0.75rem;
  padding-bottom: 2.1rem;
  overflow-wrap: anywhere;
}

:where(.documint-comment-popover-header),
:where(.documint-comment-popover-actions),
:where(.documint-comment-message-meta) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

:where(.documint-comment-popover-header) {
  margin-bottom: 0.7rem;
}

:where(.documint-comment-popover-link) {
  display: grid;
  gap: 0.3rem;
  margin-bottom: 0.8rem;
  padding-bottom: 0.8rem;
  border-bottom: 1px solid var(--documint-leaf-divider-color);
}

:where(.documint-comment-popover-create) {
  --documint-comment-create-scale-duration: 180ms;
  --documint-comment-create-fade-duration: 120ms;
  height: auto;
  padding: 0;
  overflow: visible;
}

:where(.documint-comment-popover-create-shell) {
  position: relative;
  display: grid;
  width: max-content;
  height: 100%;
}

:where(.documint-comment-popover-create-shell > .documint-leaf-toolbar) {
  position: relative;
  z-index: 0;
}

:where(.documint-comment-popover-create.is-expanded .documint-comment-popover-create-shell) {
  width: 100%;
  min-height: 5.5rem;
}

:where(.documint-comment-popover-create.is-expanded .documint-comment-popover-create-shell > .documint-leaf-toolbar) {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}

:where(.documint-comment-popover-create-button) {
  width: 1.7rem;
  height: 1.7rem;
  padding: 0;
  line-height: 0;
  position: relative;
  z-index: 0;
  display: inline-flex;
  opacity: 1;
  transform: scale(1);
  transition:
    opacity var(--documint-comment-create-fade-duration) ease,
    transform var(--documint-comment-create-scale-duration) ease;
}

:where(.documint-comment-popover-create-divider) {
  opacity: 1;
  transition: opacity var(--documint-comment-create-fade-duration) ease;
}

:where(.documint-comment-popover-create-mark) {
  opacity: 1;
  transition:
    opacity var(--documint-comment-create-fade-duration) ease,
    transform var(--documint-comment-create-scale-duration) ease;
}

:where(.documint-comment-popover-create.is-expanded .documint-comment-popover-create-button),
:where(.documint-comment-popover-create.is-expanded .documint-comment-popover-create-mark) {
  opacity: 0;
  transform: scale(0.72);
  pointer-events: none;
}

:where(.documint-comment-popover-create.is-expanded .documint-comment-popover-create-divider) {
  opacity: 0;
}

:where(.documint-comment-popover-create-content) {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  opacity: 0;
  transform: scale(0);
  transform-origin: top left;
  transition:
    opacity var(--documint-comment-create-fade-duration) ease,
    transform var(--documint-comment-create-scale-duration) ease;
  pointer-events: none;
  z-index: 1;
}

:where(.documint-comment-popover-create.is-expanded .documint-comment-popover-create-content) {
  position: relative;
  opacity: 1;
  transform: scale(1);
  pointer-events: auto;
  z-index: 0;
}

:where(.documint-comment-popover-age) {
  color: var(--documint-leaf-secondary-text);
  font-size: 0.76rem;
}

:where(.documint-comment-thread) {
  display: grid;
  gap: 0.75rem;
  max-height: 16rem;
  margin-bottom: 0.8rem;
  overflow: auto;
}

:where(.documint-comment-thread.is-empty) {
  max-height: 0;
  margin-bottom: 0;
  overflow: hidden;
}

:where(.documint-comment-message) {
  display: grid;
  gap: 0.55rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--documint-leaf-divider-color);
}

:where(.documint-comment-message-root) {
  transform: translateY(-8px) scaleY(0);
  transform-origin: top left;
  opacity: 0;
  transition:
    opacity 140ms ease,
    transform 180ms ease;
}

:where(.documint-comment-message-root.is-visible) {
  transform: translateY(0) scaleY(1);
  opacity: 1;
}

:where(.documint-comment-message-root.is-hidden) {
  max-height: 0;
  padding-bottom: 0;
  border-bottom: 0;
  overflow: hidden;
}

:where(.documint-comment-message:last-child) {
  padding-bottom: 0;
  border-bottom: 0;
}

:where(.documint-comment-reply) {
  position: relative;
  display: block;
  padding-top: 0.85rem;
  border-top: 1px solid var(--documint-leaf-divider-color);
}

:where(.documint-comment-reply.is-standalone) {
  padding-top: 0;
  border-top: 0;
}

:where(.documint-comment-reply.is-standalone:not(.is-visible)) {
  max-height: 0;
  overflow: hidden;
}

:where(.documint-leaf-shell[data-status="resolved"] .documint-comment-reply) {
  border-top-color: color-mix(in srgb, var(--documint-leaf-resolved-border) 72%, transparent);
}

:where(.documint-comment-message-meta span) {
  color: var(--documint-leaf-secondary-text);
  font-size: 0.74rem;
}

:where(.documint-comment-actions) {
  display: flex;
  gap: 0.4rem;
}

:where(.documint-leaf-action) {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  height: auto;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--documint-leaf-button-text);
  cursor: pointer;
  font: inherit;
}

:where(.documint-leaf-action-text) {
  padding: 0.35rem 0.62rem;
  border: 1px solid var(--documint-leaf-button-border);
  border-radius: 999px;
  background: var(--documint-leaf-button-bg);
}

:where(.documint-leaf-action:not(.documint-leaf-action-text)) {
  line-height: 0;
}

:where(.documint-leaf-action:disabled) {
  opacity: 0.45;
  cursor: default;
}

:where(.documint-leaf-action-danger) {
  color: var(--documint-leaf-accent);
}

:where(.documint-comment-input) {
  box-sizing: border-box;
  width: 100%;
  min-height: 4.6rem;
  padding: 0.65rem 3.2rem 0.75rem 0.75rem;
  border: 1px solid var(--documint-leaf-border);
  border-radius: 0.75rem;
  background: var(--documint-leaf-button-bg);
  color: var(--documint-leaf-text);
  font: inherit;
  resize: none;
}

:where(.documint-leaf-shell[data-status="resolved"] .documint-comment-input) {
  border-color: var(--documint-leaf-resolved-border);
}

:where(.documint-comment-input::placeholder) {
  color: var(--documint-leaf-secondary-text);
}

:where(.documint-edit-input-field) {
  position: relative;
  width: 100%;
  min-width: 0;
}

:where(.documint-link-popover-row > .documint-edit-input-field) {
  width: 100%;
}

:where(.documint-edit-input-cancel) {
  position: absolute;
  right: 0.7rem;
  top: 0.7rem;
}

:where(.documint-edit-input-save) {
  position: absolute;
  right: 0.7rem;
  bottom: calc(0.7rem + 3px);
}

:where(.documint-comment-reply-field) {
  position: relative;
}

:where(.documint-comment-reply-submit) {
  position: absolute;
  right: 0.7rem;
  bottom: calc(0.7rem + 3px);
}
`;
