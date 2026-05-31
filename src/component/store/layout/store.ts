import type { EditorLayoutState } from "@/editor";

export type LayoutListener = () => void;

export type EditorLayoutHandle = {
  /**
   * Return the latest layout, computing it via the registered resolver if
   * the cache is empty. The result always reflects current inputs because
   * `invalidate()` clears the cache the instant any input changes.
   *
   * For hot pointer paths and hit testing — `usePointer`, `useInput`,
   * and `resolveLeafAnchor` in the render body. These callers need
   * geometry that matches the live scroll/state, not the painted frame.
   */
  get: () => EditorLayoutState;
  /**
   * Return the latest layout without recomputing — `null` if the cache
   * was invalidated and no consumer has refilled it since.
   *
   * Used as a freshness gate by the lighter paint paths (`renderContent`,
   * `renderOverlay`): paint with the cached layout when one exists, skip
   * otherwise. A skipped frame is safe because every invalidation site
   * also queues `scheduleFullRender()`, so a full repaint is always en
   * route to fill the cache and paint a complete frame.
   */
  peekLatest: () => EditorLayoutState | null;
};

// Owns the layout cache and acts as the synchronization point between the
// canvas paint pipeline and React-reactive consumers. Two layout slots live
// here, each with a distinct invariant:
//
//   - `latestLayout` — the freshest layout, fresh against every current
//     input or `null` (just invalidated, not yet read). Filled by `get()`
//     (lazy resolve during hit tests) or by `commit()` (at paint time).
//     Cleared by `invalidate()` on scroll, doc transitions, and prop changes.
//   - `renderedLayout` — what's currently painted on the canvas. Updated
//     only by `commit()`, so reactive consumers stay locked to the painted
//     frame and don't see pre-paint geometry from hit-test recomputes.
//
// `commit()` is the moment `latestLayout` becomes `renderedLayout` and
// listeners fire. Hot pointer paths skip the commit and read `latest`
// directly via `get()`; only the render path commits.
export type LayoutStore = EditorLayoutHandle & {
  /**
   * Mark the latest layout as stale. Called from every site that mutates
   * an input the layout depends on (scroll, document transitions, width,
   * theme, resources, viewport height). Each call site also queues a
   * `scheduleFullRender()` — see the comments in `Documint.tsx` — so the
   * cache never stays empty past the next animation frame.
   */
  invalidate: () => void;
  /**
   * Resolve the latest layout if needed, promote it to the rendered slot,
   * and notify subscribers. The single writer that bridges latest →
   * rendered. Called by the render path (`renderViewport` → hook's
   * `commitLayout`) right before painting the canvas; the returned layout
   * is what the paint functions should draw against.
   */
  commit: () => EditorLayoutState;
  /**
   * Return the layout that's currently on the canvas (or `null` before
   * the first paint). The read side of `renderedLayoutSprig` — the source
   * sprig powering every layout-dependent computed sprig (selection
   * handles, caret target, leaf overlays, presence, image-at-cursor).
   *
   * Reactive consumers must read this rather than `peekLatest()` so React
   * overlays stay positioned against the visible canvas during the
   * pre-paint window (when a hit-test has filled `latest` with geometry
   * the canvas hasn't drawn yet).
   */
  peekRendered: () => EditorLayoutState | null;
  /**
   * Install the closure that builds an `EditorLayoutState` from current
   * hook inputs (state, viewport metrics, theme, resources). `useViewport`
   * registers this once per store via a ref-cell pattern — the wrapper it
   * passes here reads through a ref, so the resolver sees fresh hook
   * state on every call without being re-registered.
   */
  setLayoutResolver: (resolve: () => EditorLayoutState) => void;
  /**
   * Subscribe to `commit()` notifications. Used by `renderedLayoutSprig`
   * to translate paint events into reactive updates for the sprig DAG and
   * `useSyncExternalStore`.
   */
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
