// Editor animation types and state helpers. Separated from state.ts to
// keep animation concerns separate from the core state machine.
import { getEditorAnimationDuration } from "../canvas/animations";
import type { EditorState } from "./state";

export type EditorAnimation =
  | ActiveBlockFlashAnimation
  | DeletedTextFadeAnimation
  | InsertedTextHighlightAnimation
  | ListMarkerPopAnimation
  | PunctuationPulseAnimation;

export type ActiveBlockFlashAnimation = {
  blockPath: string;
  kind: "active-block-flash";
  startedAt: number;
};

export type DeletedTextFadeAnimation = {
  kind: "deleted-text-fade";
  regionPath: string;
  startOffset: number;
  startedAt: number;
  text: string;
};

export type InsertedTextHighlightAnimation = {
  endOffset: number;
  kind: "inserted-text-highlight";
  regionPath: string;
  startOffset: number;
  startedAt: number;
};

export type ListMarkerPopAnimation = {
  blockPath: string;
  kind: "list-marker-pop";
  startedAt: number;
};

export type PunctuationPulseAnimation = {
  kind: "punctuation-pulse";
  offset: number;
  regionPath: string;
  startedAt: number;
};

export function addInsertedTextHighlightAnimation(
  state: EditorState,
  insertedTextLength: number,
  startedAt = getEditorAnimationTime(),
): EditorState {
  if (insertedTextLength <= 0) {
    return state;
  }

  const region = state.documentIndex.regionIndex.get(state.selection.focus.regionId);

  if (!region) {
    return state;
  }

  const endOffset = state.selection.focus.offset;
  const startOffset = Math.max(0, endOffset - insertedTextLength);

  if (endOffset <= startOffset) {
    return state;
  }

  return addEditorAnimation(state, {
    endOffset,
    kind: "inserted-text-highlight",
    regionPath: region.path,
    startOffset,
    startedAt,
  });
}

export function addDeletedTextFadeAnimation(
  state: EditorState,
  input: {
    regionPath: string;
    startOffset: number;
    text: string;
  },
  startedAt = getEditorAnimationTime(),
): EditorState {
  if (input.text.length === 0) {
    return state;
  }

  return addEditorAnimation(state, {
    kind: "deleted-text-fade",
    regionPath: input.regionPath,
    startOffset: input.startOffset,
    startedAt,
    text: input.text,
  });
}

export function addActiveBlockFlashAnimation(
  state: EditorState,
  blockPath: string,
  startedAt = getEditorAnimationTime(),
): EditorState {
  return addEditorAnimation(state, {
    blockPath,
    kind: "active-block-flash",
    startedAt,
  });
}

export function addPunctuationPulseAnimation(
  state: EditorState,
  startedAt = getEditorAnimationTime(),
): EditorState {
  const region = state.documentIndex.regionIndex.get(state.selection.focus.regionId);
  const offset = state.selection.focus.offset - 1;

  if (!region || offset < 0 || region.text[offset] !== ".") {
    return state;
  }

  return addEditorAnimation(state, {
    kind: "punctuation-pulse",
    offset,
    regionPath: region.path,
    startedAt,
  });
}

export function addListMarkerPopAnimation(
  state: EditorState,
  blockPath: string,
  startedAt = getEditorAnimationTime(),
): EditorState {
  return addEditorAnimation(state, {
    blockPath,
    kind: "list-marker-pop",
    startedAt,
  });
}

function addEditorAnimation(state: EditorState, animation: EditorAnimation): EditorState {
  const activeAnimations = pruneEditorAnimations(state.animations, animation.startedAt);

  return {
    ...state,
    animations: [...activeAnimations, animation],
  };
}

export function pruneEditorAnimations(animations: EditorAnimation[], now: number) {
  return animations.filter(
    (animation) => animation.startedAt + getEditorAnimationDuration(animation) > now,
  );
}

export function getEditorAnimationTime() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// Resolves the block path for the currently focused block, used as the
// target for the active block flash animation.
export function resolveFocusedBlockPath(state: EditorState): string {
  const focusedRegion = state.documentIndex.regionIndex.get(state.selection.focus.regionId);
  const focusedBlock = focusedRegion
    ? (state.documentIndex.blockIndex.get(focusedRegion.blockId) ?? null)
    : null;

  return focusedBlock?.path ?? "";
}

export function hasNewAnimation(previousState: EditorState, nextState: EditorState) {
  const previousLatestStart = Math.max(
    -Infinity,
    ...previousState.animations.map((animation) => animation.startedAt),
  );

  return nextState.animations.some((animation) => animation.startedAt > previousLatestStart);
}
