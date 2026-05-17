import type { EditorLayoutState } from "@/editor";
import type { DocumintSprig } from "../core/sprigs";

export const publishedViewportSprig: DocumintSprig<EditorLayoutState | null> = {
  read: (store) => store.viewport.peekPublished(),
  subscribe: (store, listener) => store.viewport.subscribe(listener),
};
