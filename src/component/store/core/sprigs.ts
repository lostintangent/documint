import type { DocumintStore } from "..";

/**
 * A sprig is a cached, synchronous read over the store plus the sources that
 * read depends on. React subscribes to those sources and lets
 * `useSyncExternalStore` drop notifications whose snapshot kept its identity.
 */
export type DocumintSprig<T, Params extends readonly unknown[] = readonly []> = {
  read: (store: DocumintStore, ...params: Params) => T;
  sources: readonly SprigSource<unknown>[];
};

/**
 * One external mutable container sprigs read from: `read` returns its current
 * snapshot and `subscribe` installs a change listener. Source descriptors are
 * the only place where store-subscribe wiring lives.
 */
export type SprigSource<S> = {
  read: (store: DocumintStore) => S;
  subscribe: (store: DocumintStore, listener: () => void) => () => void;
};

/**
 * Build a sprig that selects a value from one source's snapshot. Every
 * reactive computation bottoms out at one of these.
 */
export function createSourceSprig<S, T>(
  source: SprigSource<S>,
  select: (snapshot: S) => T,
): DocumintSprig<T> {
  return { read: (store) => select(source.read(store)), sources: [source] };
}
