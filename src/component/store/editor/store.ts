import type { EditorState } from "@/editor";
import { createEditorStateTransition, type EditorStateTransition } from "./transitions";

export type EditorTransitionListener = (transition: EditorStateTransition) => void;

// The editor store is a pure event source. `subscribe` is the single
// notification primitive — selectors, equality, and value-level dedup all
// live in the sprig layer (`createEditorStateSprig`). Command-driven
// mutations emit `source: "local"`; `replace` emits `source: "external"`
// so the host can avoid echoing them back as `onContentChanged`.
export type EditorStore = {
  getState: () => EditorState;
  command: <A extends unknown[]>(
    command: (state: EditorState, ...args: A) => EditorState | null,
    ...args: A
  ) => EditorStateTransition | null;
  replace: (nextState: EditorState) => EditorStateTransition | null;
  subscribe: (listener: EditorTransitionListener) => () => void;
};

export function createEditorStore(initialState: EditorState): EditorStore {
  let state = initialState;
  const listeners = new Set<EditorTransitionListener>();

  const publish = (
    nextState: EditorState | null,
    source: "local" | "external",
  ): EditorStateTransition | null => {
    if (!nextState || nextState === state) {
      return null;
    }

    const previous = state;
    const transition = createEditorStateTransition(previous, nextState, source);
    state = nextState;

    for (const listener of listeners) {
      listener(transition);
    }

    return transition;
  };

  return {
    getState: () => state,

    command(command, ...args) {
      return publish(command(state, ...args), "local");
    },

    replace(nextState) {
      return publish(nextState, "external");
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
