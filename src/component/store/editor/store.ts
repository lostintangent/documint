import { takeEditorEffects, type EditorState } from "@/editor";
import { createEditorStateTransition, type EditorStateTransition } from "./transitions";

type EditorTransitionListener = (transition: EditorStateTransition) => void;

// The editor store is a pure event source. `subscribe` is the single
// notification primitive. Selection and value-level dedup live in the sprig
// layer: sprigs select from `editorSource`, and React skips notifications
// whose sprig snapshot kept its identity.
// Command-driven mutations emit `source: "local"`; `replace` emits
// `source: "external"` so the host can avoid echoing them back as
// `onContentChanged`.
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
    const effects = takeEditorEffects(nextState);
    const transition = createEditorStateTransition(
      previous,
      nextState,
      source,
      source === "local" ? effects : [],
    );
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
