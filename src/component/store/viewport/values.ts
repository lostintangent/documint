import type { EditorLayoutState } from "@/editor";
import { createStoreValue } from "../core/values";

export const publishedViewportValue = createStoreValue<EditorLayoutState | null>({
  read: (store) => store.viewport.peekPublishedViewport(),
  subscribe: (store, listener) => store.viewport.subscribe(listener),
});
