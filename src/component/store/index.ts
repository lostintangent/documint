import type { Document } from "@/document";
import { createEditorState } from "@/editor";
import { createEditorStore, type EditorStore } from "./editor/store";
import { createLayoutStore, type LayoutStore } from "./layout/store";

export type DocumintStore = {
  editor: EditorStore;
  layout: LayoutStore;
};

export function createStore(initialDocument: Document): DocumintStore {
  return {
    editor: createEditorStore(createEditorState(initialDocument)),
    layout: createLayoutStore(),
  };
}

export { DocumintStoreProvider, useDocumintStore, useEditorCommand, useSprig } from "./react";
export {
  activeCommentIndexSprig,
  caretInViewportSprig,
  caretTargetSprig,
  commentRangesSprig,
  commentStateSprig,
  cursorScrollTargetSprig,
  documentCompletionSprig,
  imageAtCursorSprig,
  normalizedSelectionSprig,
  selectionContextSprig,
  selectionViewSprig,
  type CursorScrollTarget,
  type DocumentCompletion,
  type ImageAtCursor,
} from "./editor/computed-sprigs";
export { renderedLayoutSprig } from "./layout/sprigs";
export {
  documentIndexSprig,
  editorStateSprig,
  imageUrlsSprig,
  selectionSprig,
} from "./editor/sprigs";
export type { EditorStateTransition } from "./editor/transitions";
export { commentPresenceSprig, resolvedPresenceSprig } from "./presence";
