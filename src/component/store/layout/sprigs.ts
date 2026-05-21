import type { EditorLayoutState } from "@/editor";
import { createSourceSprig, type SprigSource } from "../core/sprigs";

const renderedLayoutSource: SprigSource<EditorLayoutState | null> = {
  read: (store) => store.layout.peekRendered(),
  subscribe: (store, listener) => store.layout.subscribe(listener),
};

export const renderedLayoutSprig = createSourceSprig(renderedLayoutSource, (state) => state);
