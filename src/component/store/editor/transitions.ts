import type { EditorState } from "@/editor";

export type EditorStateTransitionSource = "external" | "local";
export type EditorTransitionReason = "command" | "external" | "reconciliation";
export type EditorReplaceReason = Extract<EditorTransitionReason, "external" | "reconciliation">;

export type EditorStateTransition = {
  previous: EditorState;
  next: EditorState;
  source: EditorStateTransitionSource;
  reason: EditorTransitionReason;
  documentChanged: boolean;
  animationsChanged: boolean;
};

export type EditorTransition = EditorStateTransition;

export function createEditorTransition(
  previous: EditorState,
  next: EditorState,
  reason: EditorTransitionReason,
): EditorTransition {
  return createTransition(previous, next, reason);
}

export function createEditorStateTransition(
  previous: EditorState,
  next: EditorState,
  source: EditorStateTransitionSource,
): EditorStateTransition {
  return createTransition(previous, next, source === "external" ? "external" : "command");
}

function createTransition(
  previous: EditorState,
  next: EditorState,
  reason: EditorTransitionReason,
): EditorTransition {
  return {
    previous,
    next,
    source: reason === "external" ? "external" : "local",
    reason,
    documentChanged: previous.documentIndex !== next.documentIndex,
    animationsChanged: previous.animations !== next.animations && next.animations.length > 0,
  };
}
