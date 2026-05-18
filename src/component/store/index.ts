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

export { DocumintStoreProvider, useDocumintStore, useEditorCommand, useSprig } from "./react";
export {
  activeCommentIndexSprig,
  caretInViewportSprig,
  caretTargetSprig,
  commentStateSprig,
  completionSourcesSprig,
  cursorLeafSprig,
  documentCompletionSprig,
  imageAtCursorSprig,
  normalizedSelectionSprig,
  pointerViewSprig,
  selectionContextSprig,
  selectionLeafSprig,
  selectionViewSprig,
  type CursorLeaf,
  type DocumentCompletion,
  type ImageAtCursor,
  type PointerLeaf,
  type PointerView,
  type PromotedSelectionThread,
  type SelectionLeaf,
} from "./editor/computed-sprigs";
export { publishedViewportSprig } from "./viewport/sprigs";
export {
  documentIndexSprig,
  editorStateSprig,
  imageUrlsSprig,
  selectionSprig,
} from "./editor/sprigs";
export type { EditorStateTransition } from "./editor/transitions";
export { commentPresenceSprig, resolvedPresenceSprig } from "./presence";
