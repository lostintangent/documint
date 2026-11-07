// Host-event fixtures shared by `test/component/`. Editor state
// setup lives in `test/editor/helpers.ts`.

export function createKeyboardEvent(key: string, options: KeyboardEventInit = {}) {
  return {
    altKey: options.altKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    key,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
  } as KeyboardEvent;
}
