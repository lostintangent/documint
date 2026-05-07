import type { EditorLayoutState } from "@/editor";

export type LayoutListener = () => void;

export type ViewportLayoutHandle = {
  get: () => EditorLayoutState;
  peek: () => EditorLayoutState | null;
};

// Owns the lazy viewport layout cache and publishes completed viewport renders
// to reactive consumers. `get()` may compute a fresh layout;
// `observeViewport` marks that layout as the latest rendered snapshot and
// notifies subscribers.
export type ViewportStore = ViewportLayoutHandle & {
  invalidate: () => void;
  observeViewport: (viewport: EditorLayoutState) => void;
  peekPublishedViewport: () => EditorLayoutState | null;
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

    peek() {
      return cachedViewport;
    },

    observeViewport(viewport) {
      publish(viewport);
    },

    peekPublishedViewport() {
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
