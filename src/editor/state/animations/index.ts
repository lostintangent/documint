// Editor animations: transient visual descriptors layered on top of state
// mutations. Action resolvers declare semantic animation intent; the reducer
// materializes that intent after the edit has produced the next immutable
// state. Paint resolves the resulting descriptors frame-by-frame.
//
// State owns the model-lifetime half of animations: the descriptor types,
// the duration table that drives pruning, and the running-animations
// predicate the host uses to gate frame scheduling. Paint-time resolution
// (mapping descriptors to per-frame `{ ...descriptor, progress }` values and
// blending colors) lives in `canvas/lib/animations`.

import type { AnimationIntent, EditorState } from "../types";

// --- Duration table ---
//
// Animation durations are model-lifetime policy: the reducer prunes by them
// and the host schedules frames by them. Paint also reads them to compute
// per-frame `progress`, but the source of truth is here.

const activeBlockFlashDurationMs = 300;
const textFadeDurationMs = 180;
const textHighlightDurationMs = 1000;
const blockPulseDurationMs = 500;
const textPulseDurationMs = 140;

// --- Animation types ---

export type EditorAnimation =
  | ActiveBlockFlashAnimation
  | BlockPulseAnimation
  | TextFadeAnimation
  | TextHighlightAnimation
  | TextPulseAnimation;

export type ActiveBlockFlashAnimation = {
  blockPath: string;
  kind: "active-block-flash";
  startedAt: number;
};

export type BlockPulseAnimation = {
  blockPath: string;
  kind: "block-pulse";
  startedAt: number;
};

export type TextFadeAnimation = {
  kind: "text-fade";
  regionPath: string;
  startOffset: number;
  startedAt: number;
  text: string;
};

export type TextHighlightAnimation = {
  endOffset: number;
  kind: "text-highlight";
  regionPath: string;
  startOffset: number;
  startedAt: number;
};

export type TextPulseAnimation = {
  kind: "text-pulse";
  offset: number;
  regionPath: string;
  startedAt: number;
};

export function getEditorAnimationDuration(animation: EditorAnimation) {
  switch (animation.kind) {
    case "active-block-flash":
      return activeBlockFlashDurationMs;
    case "text-fade":
      return textFadeDurationMs;
    case "text-highlight":
      return textHighlightDurationMs;
    case "block-pulse":
      return blockPulseDurationMs;
    case "text-pulse":
      return textPulseDurationMs;
  }
}

export function hasRunningEditorAnimations(state: EditorState, now?: number) {
  const animationTime = now ?? getEditorAnimationTime();

  return state.animations.some(
    (animation) => animationTime - animation.startedAt < getEditorAnimationDuration(animation),
  );
}

// --- Intent materialization ---

export function addAnimationIntent(
  state: EditorState,
  animation: AnimationIntent | undefined,
  startedAt = getEditorAnimationTime(),
): EditorState {
  if (!animation) {
    return state;
  }

  switch (animation.kind) {
    case "text-highlight":
      return animation.endOffset > animation.startOffset
        ? addEditorAnimation(state, { ...animation, startedAt })
        : state;

    case "text-fade":
      return animation.text.length > 0
        ? addEditorAnimation(state, { ...animation, startedAt })
        : state;

    case "text-pulse":
    case "block-pulse":
      return addEditorAnimation(state, { ...animation, startedAt });
  }
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
  return performance.now();
}

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
