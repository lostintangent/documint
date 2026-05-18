import type { EditorState } from "@/editor";

// `"external"` means the transition was driven by something outside the
// editor (host props, network sync) and the host should not echo it back as
// an `onContentChanged` event. `"local"` is every command-driven mutation.
export type EditorStateTransitionSource = "external" | "local";

export type EditorStateTransition = {
  previous: EditorState;
  next: EditorState;
  source: EditorStateTransitionSource;
  documentChanged: boolean;
  changedRootIndexes: readonly number[];
  animationsChanged: boolean;
};

export function createEditorStateTransition(
  previous: EditorState,
  next: EditorState,
  source: EditorStateTransitionSource,
): EditorStateTransition {
  const documentChanged = previous.documentIndex !== next.documentIndex;

  return {
    previous,
    next,
    source,
    documentChanged,
    changedRootIndexes: documentChanged ? resolveChangedRootIndexes(previous, next) : [],
    animationsChanged: previous.animations !== next.animations && next.animations.length > 0,
  };
}

function resolveChangedRootIndexes(
  previous: EditorState,
  next: EditorState,
): readonly number[] {
  const previousBlocks = previous.documentIndex.document.blocks;
  const nextBlocks = next.documentIndex.document.blocks;

  if (previousBlocks.length !== nextBlocks.length) {
    return nextBlocks.map((_, index) => index);
  }

  // Single-pass scan into one result array. The `flatMap(b === prev ? [] : [i])`
  // idiom is terser but allocates an empty array per unchanged block — meaningful
  // garbage on every document-changing transition for large docs.
  const changed: number[] = [];
  for (let index = 0; index < nextBlocks.length; index += 1) {
    if (nextBlocks[index] !== previousBlocks[index]) {
      changed.push(index);
    }
  }
  return changed;
}
