import type { EditorState } from "@/editor";
import type { DocumintStore } from "..";
import { defaultEquality, type Equality } from "./equality";

type EditorStateSelector<T> = (state: EditorState) => T;

export type DocumintSprig<T, Params extends readonly unknown[] = readonly []> = {
  read: (store: DocumintStore, ...params: Params) => T;
  subscribe: (store: DocumintStore, listener: () => void, ...params: Params) => () => void;
};

/**
 * Build a source sprig that taps directly into `EditorState`. The sprig
 * captures the selected value at subscription time and only notifies when
 * a later transition produces a value the equality predicate considers
 * different — consumers don't need to re-check equality themselves.
 *
 * This is the foundation of the sprig DAG: every other derivation reaches
 * `EditorState` through one of these (or through another sprig that does).
 */
export function createEditorStateSprig<T>(
  select: EditorStateSelector<T>,
  equal: Equality<T> = defaultEquality,
): DocumintSprig<T> {
  return {
    read: (store) => select(store.editor.getState()),
    subscribe: (store, listener) => {
      let selected = select(store.editor.getState());
      return store.editor.subscribe((transition) => {
        const nextSelected = select(transition.next);
        if (equal(selected, nextSelected)) {
          return;
        }
        selected = nextSelected;
        listener();
      });
    },
  };
}
