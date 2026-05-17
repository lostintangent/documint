import type { EditorLayoutState } from "@/editor";

export type LayoutListener = () => void;

export type EditorLayoutHandle = {
  // Return the current layout, computing it if the cache is empty.
  get: () => EditorLayoutState;
  // Return the cached layout without recomputing. Cheap paint paths use
  // this to skip the recompute cost on frames that can reuse the cache.
  peekCached: () => EditorLayoutState | null;
};

// Owns the lazy viewport layout cache and publishes completed viewport
// renders to reactive consumers. Two distinct frames live here:
//
//   - `cachedViewport` — the eager cache, recomputed via the host's
//     resolver when invalidated. Hot paths read it via `get()` / `peekCached()`.
//   - `publishedViewport` — the last frame `observeViewport()` saw the
//     renderer paint. Reactive consumers subscribe to this; it updates
//     once per painted frame, not per cache invalidation.
export type ViewportStore = EditorLayoutHandle & {
  invalidate: () => void;
  observeViewport: (viewport: EditorLayoutState) => void;
  peekPublished: () => EditorLayoutState | null;
  setViewportResolver: (resolve: () => EditorLayoutState) => void;
  subscribe: (listener: LayoutListener) => () => void;
};

export function createViewportStore(): ViewportStore {
  let cachedViewport: EditorLayoutState | null = null;
  let publishedViewport: EditorLayoutState | null = null;
  let resolveViewport: (() => EditorLayoutState) | null = null;
  const listeners = new Set<LayoutListener>();

  const publish = (viewport: EditorLayoutState) => {
    cachedViewport = viewport;

    if (publishedViewport === viewport) {
      return;
    }

    publishedViewport = viewport;

    for (const listener of listeners) {
      listener();
    }
  };

  return {
    get() {
      if (cachedViewport) {
        return cachedViewport;
      }

      if (!resolveViewport) {
        throw new Error("Viewport resolver has not been registered.");
      }

      cachedViewport = resolveViewport();
      return cachedViewport;
    },

    invalidate() {
      cachedViewport = null;
    },

    peekCached() {
      return cachedViewport;
    },

    observeViewport(viewport) {
      publish(viewport);
    },

    peekPublished() {
      return publishedViewport;
    },

    setViewportResolver(resolve) {
      resolveViewport = resolve;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
