import type { EditorLayoutState } from "@/editor";
import { createComputedSprig } from "../core/computed";
import { equalNullableBy } from "../core/equality";
import { createSourceSprig, type SprigSource } from "../core/sprigs";

const renderedLayoutSource: SprigSource<EditorLayoutState | null> = {
  read: (store) => store.layout.peekRendered(),
  subscribe: (store, listener) => store.layout.subscribe(listener),
};

export const renderedLayoutSprig = createSourceSprig(renderedLayoutSource, (state) => state);

export type RenderedViewportSize = {
  height: number;
  width: number;
};

// Narrow subscription for effects that care about resize/orientation, not
// scroll position. This is computed over `renderedLayoutSprig` so unchanged
// dimensions preserve snapshot identity for `useSyncExternalStore`.
export const renderedViewportSizeSprig = createComputedSprig(
  [renderedLayoutSprig],
  (_store, state): RenderedViewportSize | null =>
    state ? { height: state.viewport.height, width: state.viewport.width } : null,
  equalNullableBy<RenderedViewportSize>((viewport) => [viewport.width, viewport.height]),
);
