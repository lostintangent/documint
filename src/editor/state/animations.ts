// Editor animations: presentation side-effects layered on top of state
// mutations. The action/reducer pipeline stays pure; animations live here
// so they can be added at the boundary where the operation's intent is
// known.
//
// Most animations are triggered at the command layer — the command knows
// what semantic operation just happened (typed a character, deleted plain
// text, split a list item) and decides whether the result deserves visual
// feedback. The exception is `active-block-flash`, which fires from
// `setSelection` itself so every selection change can trigger it without
// each command having to remember.
//
// This module owns the animation type shapes, the "add" helpers commands
// call, and the lifecycle primitives (prune, time, has-new).

import { getEditorAnimationDuration } from "../canvas/lib/animations";
import type { EditorState } from "./types";

// --- Animation types ---

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

// --- Trigger helpers (called from the command layer or setSelection) ---

export function addInsertedTextHighlightAnimation(
  state: EditorState,
  insertedTextLength: number,
  startedAt = getEditorAnimationTime(),
): EditorState {
  if (insertedTextLength <= 0) {
    return state;
  }

  const region = resolveFocusedRegion(state);

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

// Adds a fade animation when the deleted range was a "plain" inline (no
// marks, no link, no image). Used by character-delete commands so that
// removing styled or linked text doesn't visually "ghost" the formatting.
export function addPlainTextDeletionFadeAnimation(
  previousState: EditorState,
  nextState: EditorState,
  startOffset: number,
  endOffset: number,
): EditorState {
  const region = resolveFocusedRegion(previousState);

  if (!region) {
    return nextState;
  }

  const text = region.text.slice(startOffset, endOffset);

  if (text.length === 0) {
    return nextState;
  }

  const isPlainText = region.inlines.some(
    (entry) =>
      entry.start <= startOffset &&
      entry.end >= endOffset &&
      entry.kind === "text" &&
      entry.link === null &&
      entry.marks.length === 0,
  );

  if (!isPlainText) {
    return nextState;
  }

  return addEditorAnimation(nextState, {
    kind: "deleted-text-fade",
    regionPath: region.path,
    startOffset,
    startedAt: getEditorAnimationTime(),
    text,
  });
}

export function addPunctuationPulseAnimation(
  state: EditorState,
  startedAt = getEditorAnimationTime(),
): EditorState {
  const region = resolveFocusedRegion(state);
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

// --- Lifecycle ---

export function pruneEditorAnimations(animations: EditorAnimation[], now: number) {
  return animations.filter(
    (animation) => animation.startedAt + getEditorAnimationDuration(animation) > now,
  );
}

export function getEditorAnimationTime() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function hasNewAnimation(previousState: EditorState, nextState: EditorState) {
  const previousLatestStart = Math.max(
    -Infinity,
    ...previousState.animations.map((animation) => animation.startedAt),
  );

  return nextState.animations.some((animation) => animation.startedAt > previousLatestStart);
}

// --- Selection helpers ---

// Resolves the block path for the currently focused block, used as the
// target for the active block flash animation.
export function resolveFocusedBlockPath(state: EditorState): string {
  const region = resolveFocusedRegion(state);
  const block = region ? (state.documentIndex.blockIndex.get(region.blockId) ?? null) : null;

  return block?.path ?? "";
}

// --- Internal ---

function resolveFocusedRegion(state: EditorState) {
  return state.documentIndex.regionIndex.get(state.selection.focus.regionId) ?? null;
}

function addEditorAnimation(state: EditorState, animation: EditorAnimation): EditorState {
  const activeAnimations = pruneEditorAnimations(state.animations, animation.startedAt);

  return {
    ...state,
    animations: [...activeAnimations, animation],
  };
}
