import type { EditorState } from "@/editor";
import { defaultEquality, type Equality } from "../core/equality";
import {
  createEditorTransition,
  type EditorReplaceReason,
  type EditorTransition,
  type EditorTransitionReason,
} from "./transitions";

export type EditorTransitionListener = (transition: EditorTransition) => void;
export type EditorValueListener = () => void;
export type EditorValueReader<T> = (state: EditorState) => T;

export type EditorStore = {
  getVersion: () => number;
  getState: () => EditorState;
  apply: (nextState: EditorState | null) => EditorTransition | null;
  command: <A extends unknown[]>(
    command: (state: EditorState, ...args: A) => EditorState | null,
    ...args: A
  ) => EditorTransition | null;
  replace: (nextState: EditorState, reason?: EditorReplaceReason) => EditorTransition | null;
  subscribe: (listener: EditorTransitionListener) => () => void;
  subscribeValue: <T>(
    read: EditorValueReader<T>,
    listener: EditorValueListener,
    equal?: Equality<T>,
  ) => () => void;
};

export function createEditorStore(initialState: EditorState): EditorStore {
  let state = initialState;
  let version = 0;
  const listeners = new Set<EditorTransitionListener>();

  const publish = (
    nextState: EditorState | null,
    reason: EditorTransitionReason,
  ): EditorTransition | null => {
    if (!nextState || nextState === state) {
      return null;
    }

    const previous = state;
    const transition = createEditorTransition(previous, nextState, reason);
    state = nextState;
    version += 1;

    for (const listener of listeners) {
      listener(transition);
    }

    return transition;
  };

  return {
    getVersion: () => version,

    getState: () => state,

    apply(nextState) {
      return publish(nextState, "command");
    },

    command(command, ...args) {
      return publish(command(state, ...args), "command");
    },

    replace(nextState, reason = "reconciliation") {
      return publish(nextState, reason);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    subscribeValue(read, listener, equal = defaultEquality) {
      let selected = read(state);

      const transitionListener: EditorTransitionListener = (transition) => {
        const nextSelected = read(transition.next);
        if (equal(selected, nextSelected)) {
          return;
        }

        selected = nextSelected;
        listener();
      };

      listeners.add(transitionListener);
      return () => {
        listeners.delete(transitionListener);
      };
    },
  };
}
