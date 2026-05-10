import type { Document } from "@/document";
import { createEditorState } from "@/editor";
import { createEditorStore, type EditorStore } from "./editor/store";
import { createViewportStore, type ViewportStore } from "./viewport/store";

export type DocumintStore = {
  editor: EditorStore;
  viewport: ViewportStore;
};

export function createStore(initialDocument: Document): DocumintStore {
  return {
    editor: createEditorStore(createEditorState(initialDocument)),
    viewport: createViewportStore(),
  };
}

export { DocumintStoreProvider, useDocumintStore, useEditorCommand, useStoreValue } from "./react";
export {
  activeCommentThreadIndexValue,
  caretInViewportValue,
  caretTargetValue,
  commentStateValue,
  completionSourcesValue,
  cursorLeafValue,
  documentCompletionValue,
  imageAtCursorValue,
  normalizedSelectionValue,
  pointerViewValue,
  selectionContextValue,
  selectionLeafValue,
  selectionViewValue,
  type CursorLeaf,
  type DocumentCompletion,
  type ImageAtCursor,
  type PointerLeaf,
  type PointerView,
  type PromotedSelectionThread,
  type SelectionLeaf,
} from "./editor/computed-values";
export { publishedViewportValue } from "./viewport/values";
export { documentIndexValue, editorStateValue, imageUrlsValue } from "./editor/values";
export { type EditorTransition } from "./editor/transitions";
export { presenceValue } from "./presence";
