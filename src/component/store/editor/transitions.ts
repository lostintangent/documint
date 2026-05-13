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
  changedRootIndexes: readonly number[];
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
  const documentChanged = previous.documentIndex !== next.documentIndex;

  return {
    previous,
    next,
    source: reason === "external" ? "external" : "local",
    reason,
    documentChanged,
    changedRootIndexes: documentChanged ? resolveChangedRootIndexes(previous, next) : [],
    animationsChanged: previous.animations !== next.animations && next.animations.length > 0,
  };
}

function resolveChangedRootIndexes(previous: EditorState, next: EditorState) {
  const previousBlocks = previous.documentIndex.document.blocks;
  const nextBlocks = next.documentIndex.document.blocks;

  if (previousBlocks.length !== nextBlocks.length) {
    return nextBlocks.map((_, index) => index);
  }

  return nextBlocks.flatMap((block, index) => (block === previousBlocks[index] ? [] : [index]));
}
