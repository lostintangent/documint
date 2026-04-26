import { useMemo } from "react";

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
  return useMemo(() => createLazyRef({ current: null }, resolve), [resolve]);
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
