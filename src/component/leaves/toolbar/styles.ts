// Shared leaf-toolbar styles for compact leaf actions and nested command menus.
export const DOCUMINT_LEAF_TOOLBAR_STYLES = `
:where(.documint-leaf-toolbar) {
  --documint-leaf-toolbar-button-active-bg:
    color-mix(in srgb, var(--documint-leaf-accent) 16%, var(--documint-leaf-bg));
  --documint-leaf-toolbar-divider-color:
    color-mix(in srgb, var(--documint-leaf-border) 72%, transparent);
  --documint-leaf-toolbar-menu-border-color:
    color-mix(in srgb, var(--documint-leaf-border) 88%, transparent);
  --documint-leaf-toolbar-menu-hover-bg:
    color-mix(in srgb, var(--documint-leaf-accent) 12%, var(--documint-leaf-bg));
  --documint-leaf-toolbar-shadow-fallback:
    0 14px 40px color-mix(in srgb, var(--documint-leaf-text) 16%, transparent);
  display: inline-flex;
  align-items: center;
  gap: 0.52rem;
}

:where(.documint-leaf-toolbar-group) {
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
}

:where(.documint-leaf-toolbar-divider) {
  width: 1px;
  height: 1.15rem;
  background: var(--documint-leaf-toolbar-divider-color);
}

:where(.documint-leaf-toolbar-button),
:where(.documint-leaf-toolbar-menu-item) {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.36rem;
  border: 0;
  background: transparent;
  color: var(--documint-leaf-button-text);
  cursor: pointer;
  font: inherit;
}

:where(.documint-leaf-toolbar-button) {
  justify-content: center;
  min-width: 1.45rem;
  height: 1.45rem;
  padding: 0 0.12rem;
  border-radius: 0.38rem;
  line-height: 0;
  transition:
    background-color 120ms ease,
    color 120ms ease;
}

:where(.documint-leaf-toolbar-menu-shell .documint-leaf-toolbar-button) {
  gap: 0.18rem;
}

:where(.documint-leaf-toolbar-button:hover) {
  background: var(--documint-leaf-toolbar-button-active-bg);
}

:where(.documint-leaf-toolbar-button:disabled) {
  opacity: 0.42;
  cursor: default;
}

:where(.documint-leaf-toolbar-button:disabled:hover) {
  background: transparent;
}

:where(.documint-leaf-toolbar-button.active) {
  background: var(--documint-leaf-toolbar-button-active-bg);
  color: var(--documint-leaf-text);
}

:where(.documint-leaf-toolbar-menu-shell) {
  position: relative;
}

:where(.documint-leaf-toolbar-menu-chevron) {
  transition: transform 140ms ease;
}

:where(.documint-leaf-toolbar-menu-chevron.is-open) {
  transform: rotate(180deg);
}

:where(.documint-leaf-toolbar-menu-popover) {
  position: absolute;
  top: calc(100% + 0.55rem);
  left: 0;
  display: grid;
  gap: 0.2rem;
  min-width: 10.5rem;
  padding: 0.35rem;
  border: 1px solid var(--documint-leaf-toolbar-menu-border-color);
  border-radius: 0.8rem;
  background: var(--documint-leaf-bg);
  box-shadow: var(--documint-leaf-shadow, var(--documint-leaf-toolbar-shadow-fallback));
}

:where(.documint-leaf-toolbar-menu-item) {
  width: 100%;
  padding: 0.45rem 0.55rem;
  border-radius: 0.55rem;
  line-height: 1.2;
  text-align: left;
}

:where(.documint-leaf-toolbar-menu-item:hover) {
  background: var(--documint-leaf-toolbar-menu-hover-bg);
}

:where(.documint-leaf-toolbar-menu-item:disabled) {
  opacity: 0.42;
  cursor: default;
}

:where(.documint-leaf-toolbar-menu-item:disabled:hover) {
  background: transparent;
}

:where(.documint-leaf-toolbar-menu-divider) {
  height: 1px;
  margin: 0.15rem 0.2rem;
  background: var(--documint-leaf-toolbar-divider-color);
}
`;
