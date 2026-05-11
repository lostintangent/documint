import type { EditorState } from "@/editor";
import { defaultEquality, type Equality } from "../core/equality";
import {
  createEditorStateTransition,
  type EditorStateTransition,
  type EditorStateTransitionSource,
} from "./transitions";

export type EditorStateTransitionListener = (transition: EditorStateTransition) => void;
export type EditorValueListener = () => void;
export type EditorValueReader<T> = (state: EditorState) => T;

export type EditorStore = {
  getVersion: () => number;
  getState: () => EditorState;
  apply: (nextState: EditorState | null) => EditorStateTransition | null;
  command: <A extends unknown[]>(
    command: (state: EditorState, ...args: A) => EditorState | null,
    ...args: A
  ) => EditorStateTransition | null;
  replace: (
    nextState: EditorState,
    source?: Extract<EditorStateTransitionSource, "external">,
  ) => EditorStateTransition | null;
  subscribe: (listener: EditorStateTransitionListener) => () => void;
  subscribeValue: <T>(
    read: EditorValueReader<T>,
    listener: EditorValueListener,
    equal?: Equality<T>,
  ) => () => void;
};

export function createEditorStore(initialState: EditorState): EditorStore {
  let state = initialState;
  let version = 0;
  const listeners = new Set<EditorStateTransitionListener>();

  const publish = (
    nextState: EditorState | null,
    source: EditorStateTransitionSource,
  ): EditorStateTransition | null => {
    if (!nextState || nextState === state) {
      return null;
    }

    const previous = state;
    const transition = createEditorStateTransition(previous, nextState, source);
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
      return publish(nextState, "local");
    },

    command(command, ...args) {
      return publish(command(state, ...args), "local");
    },

    replace(nextState, source = "external") {
      return publish(nextState, source);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    subscribeValue(read, listener, equal = defaultEquality) {
      let selected = read(state);

      const transitionListener: EditorStateTransitionListener = (transition) => {
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
