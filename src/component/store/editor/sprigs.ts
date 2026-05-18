import type { EditorState } from "@/editor";
import { createSourceSprig, type SprigSource } from "../core/sprigs";

export const editorSource: SprigSource<EditorState> = {
  read: (store) => store.editor.getState(),
  subscribe: (store, listener) => store.editor.subscribe(listener),
};

export const editorStateSprig = createSourceSprig(editorSource, (state) => state);

export const documentIndexSprig = createSourceSprig(editorSource, (state) => state.documentIndex);

export const selectionSprig = createSourceSprig(editorSource, (state) => state.selection);

export const imageUrlsSprig = createSourceSprig(
  editorSource,
  (state) => state.documentIndex.imageUrls,
);
