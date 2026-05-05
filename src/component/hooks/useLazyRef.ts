import { useRef } from "react";

/**
 * Lazily resolves an imperative value on first read and keeps it until the
 * owning component invalidates it. Child hooks depend on `LazyRefHandle` for
 * read access (`get` / `peek`); the owner uses the full `LazyRef` to mutate
 * the cache via `invalidate`.
 */
export type LazyRefHandle<T> = {
  /** Returns the cached value, computing on first access or after invalidation. */
  get: () => T;
  /** Returns the cached value if present, or null without computing. */
  peek: () => T | null;
};

export type LazyRef<T> = LazyRefHandle<T> & {
  invalidate: () => void;
};

export function useLazyRef<T>(resolve: () => T): LazyRef<T> {
  // Hold `resolve` behind a ref so the LazyRef always reads the latest
  // closure without re-creating the LazyRef itself. `useMemo([resolve])`
  // is unsafe here because `resolve` typically comes from `useEffectEvent`,
  // whose returned function identity isn't stable across all React
  // versions/configurations — observed instability would orphan the
  // populated cache on a stale instance and `peek()` against the new one
  // would always return null.
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const lazyRefRef = useRef<LazyRef<T> | null>(null);
  if (lazyRefRef.current === null) {
    lazyRefRef.current = createLazyRef({ current: null }, () => resolveRef.current());
  }
  return lazyRefRef.current;
}

function createLazyRef<T>(ref: { current: T | null }, resolve: () => T): LazyRef<T> {
  return {
    peek() {
      return ref.current;
    },
    get() {
      const cachedValue = ref.current;

      if (cachedValue !== null) {
        return cachedValue;
      }

      const next = resolve();

      ref.current = next;

      return next;
    },
    invalidate() {
      ref.current = null;
    },
  };
}
