import type { EditorEffect, EditorState } from "@/editor";

// `"external"` means the transition was driven by something outside the
// editor (host props, network sync) and the host should not echo it back as
// an `onContentChanged` event. `"local"` is every command-driven mutation.
export type EditorStateTransitionSource = "external" | "local";

export type EditorStateTransition = {
  previous: EditorState;
  next: EditorState;
  source: EditorStateTransitionSource;
  documentChanged: boolean;
  effects: readonly EditorEffect[];
  changedRootIndexes: readonly number[];
  // True when the transition emitted semantic effects that may start content
  // layer effects. Effect lifetime is owned by the component, not state.
  hasNewEffects: boolean;
};

export function createEditorStateTransition(
  previous: EditorState,
  next: EditorState,
  source: EditorStateTransitionSource,
  effects: readonly EditorEffect[] = [],
): EditorStateTransition {
  const documentChanged = previous.documentIndex !== next.documentIndex;

  return {
    previous,
    next,
    source,
    documentChanged,
    effects,
    changedRootIndexes: documentChanged ? resolveChangedRootIndexes(previous, next) : [],
    hasNewEffects: effects.length > 0,
  };
}

function resolveChangedRootIndexes(previous: EditorState, next: EditorState): readonly number[] {
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
