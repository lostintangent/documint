import type { EditorState } from "@/editor";

export type EditorStateTransitionSource = "external" | "local";

export type EditorStateTransition = {
  previous: EditorState;
  next: EditorState;
  source: EditorStateTransitionSource;
  documentChanged: boolean;
  animationsChanged: boolean;
};

export function createEditorStateTransition(
  previous: EditorState,
  next: EditorState,
  source: EditorStateTransitionSource,
): EditorStateTransition {
  return {
    previous,
    next,
    source,
    documentChanged: previous.documentIndex !== next.documentIndex,
    animationsChanged: previous.animations !== next.animations && next.animations.length > 0,
  };
}
