import type { EditorLayoutState } from "@/editor";

type LayoutListener = () => void;

export type EditorLayoutHandle = {
  /**
   * Return the latest layout, resolving it if the cache is empty. For hit
   * tests and pointer paths (`usePointer`, `useInput`) that need live
   * geometry. Don't call it during render: the React Compiler memoizes the
   * call on the stable store, so React overlays read `renderedLayoutSprig`.
   */
  get: () => EditorLayoutState;
  /**
   * Return the latest layout without resolving it, or `null` after an
   * invalidation. The lighter paint paths (`renderContent`, `renderOverlay`)
   * skip the frame on `null`, which is safe because every invalidation also
   * queues a full render.
   */
  peekLatest: () => EditorLayoutState | null;
};

// Owns two layout slots. `latestLayout` is fresh against current inputs or
// `null`, and serves hit tests and paint. `renderedLayout` is what the canvas
// shows. Only `commit()` updates it, so React overlays never see pre-paint
// geometry from a hit-test resolve.
export type LayoutStore = EditorLayoutHandle & {
  /**
   * Mark the latest layout stale. Every site that changes a layout input
   * (scroll, document transitions, width, theme, resources, viewport height)
   * calls this and also queues `scheduleFullRender()`, so the cache never
   * stays empty past the next frame.
   */
  invalidate: () => void;
  /**
   * Resolve the latest layout if needed, promote it to the rendered slot, and
   * notify subscribers. The render scheduler calls this right before painting.
   */
  commit: () => EditorLayoutState;
  /**
   * Return the layout on the canvas, or `null` before the first paint. This
   * backs `renderedLayoutSprig`, so React overlays stay aligned with the
   * visible canvas.
   */
  peekRendered: () => EditorLayoutState | null;
  /**
   * Install the closure that builds a layout from the current hook inputs.
   * `useViewport` installs it from a layout effect, and `get()` and
   * `commit()` throw until then.
   */
  setLayoutResolver: (resolve: () => EditorLayoutState) => void;
  /** Listen for `commit()` calls that change the rendered layout. */
  subscribe: (listener: LayoutListener) => () => void;
};

export function createLayoutStore(): LayoutStore {
  let latestLayout: EditorLayoutState | null = null;
  let renderedLayout: EditorLayoutState | null = null;
  let resolveLayout: (() => EditorLayoutState) | null = null;
  const listeners = new Set<LayoutListener>();

  return {
    get() {
      if (latestLayout) {
        return latestLayout;
      }

      if (!resolveLayout) {
        throw new Error("Layout resolver has not been registered.");
      }

      latestLayout = resolveLayout();
      return latestLayout;
    },

    invalidate() {
      latestLayout = null;
    },

    peekLatest() {
      return latestLayout;
    },

    commit() {
      const layout = latestLayout ?? resolveLayout?.();

      if (!layout) {
        throw new Error("Layout resolver has not been registered.");
      }

      latestLayout = layout;

      if (renderedLayout !== layout) {
        renderedLayout = layout;
        for (const listener of listeners) {
          listener();
        }
      }

      return layout;
    },

    peekRendered() {
      return renderedLayout;
    },

    setLayoutResolver(resolve) {
      resolveLayout = resolve;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
