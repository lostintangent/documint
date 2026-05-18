import type { DocumintStore } from "..";
import { defaultEquality, type Equality } from "./equality";

export type DocumintSprig<T, Params extends readonly unknown[] = readonly []> = {
  read: (store: DocumintStore, ...params: Params) => T;
  subscribe: (store: DocumintStore, listener: () => void, ...params: Params) => () => void;
};

/**
 * A source descriptor names one external mutable container that sprigs can
 * subscribe to. `read` returns the current snapshot; `subscribe` installs a
 * change listener and returns its unsubscribe handle.
 *
 * Source descriptors are the only place where store-subscribe wiring lives.
 * Once an external source has a descriptor, `createSourceSprig` builds an
 * arbitrary number of sprigs against it.
 */
export type SprigSource<S> = {
  read: (store: DocumintStore) => S;
  subscribe: (store: DocumintStore, listener: () => void) => () => void;
};

/**
 * Build a source sprig from a `SprigSource` descriptor and a selector. The
 * sprig captures the selected value at subscription time and only notifies
 * when a later source event produces a value the equality predicate
 * considers different — consumers don't need to re-check equality themselves.
 *
 * This is the foundation of the sprig DAG: every reactive computation
 * eventually bottoms out at one of these.
 */
export function createSourceSprig<S, T>(
  source: SprigSource<S>,
  select: (snapshot: S) => T,
  equal: Equality<T> = defaultEquality,
): DocumintSprig<T> {
  return {
    read: (store) => select(source.read(store)),
    subscribe: (store, listener) => {
      let selected = select(source.read(store));
      return source.subscribe(store, () => {
        const nextSelected = select(source.read(store));
        if (equal(selected, nextSelected)) return;
        selected = nextSelected;
        listener();
      });
    },
  };
}
