import type { EditorLayoutState } from "@/editor";
import { createSourceSprig, type SprigSource } from "../core/sprigs";

const viewportSource: SprigSource<EditorLayoutState | null> = {
  read: (store) => store.viewport.peekPublished(),
  subscribe: (store, listener) => store.viewport.subscribe(listener),
};

export const publishedViewportSprig = createSourceSprig(viewportSource, (state) => state);
