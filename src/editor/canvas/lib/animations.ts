// Owns paint-time animation helpers. The editor model stores transient effect
// state; this module turns that state into render-local data and color blends
// that the main paint orchestrator can apply while drawing text.

import type { EditorTheme } from "@/types";
import type {
  ActiveBlockFlashAnimation,
  DeletedTextFadeAnimation,
  EditorState,
  EditorAnimation,
  InsertedTextHighlightAnimation,
  ListMarkerPopAnimation,
  PunctuationPulseAnimation,
} from "../../state";
import { blendCanvasColors, transparentCanvasColor } from "./colors";

export type ActiveBlockFlash = ActiveBlockFlashAnimation & {
  progress: number;
};

export type ActiveDeletedTextFade = DeletedTextFadeAnimation & {
  progress: number;
};

export type ActiveInsertedTextHighlight = InsertedTextHighlightAnimation & {
  progress: number;
};

export type ActiveListMarkerPop = ListMarkerPopAnimation & {
  progress: number;
};

export type ActivePunctuationPulse = PunctuationPulseAnimation & {
  progress: number;
};

const activeBlockFlashDurationMs = 300;
const deletedTextFadeDurationMs = 180;
const insertedTextHighlightDurationMs = 1000;
const listMarkerPopDurationMs = 500;
const punctuationPulseDurationMs = 140;

// List marker pop reaches full scale in the first half of its duration,
// then blends color back to the base in the second half.
const LIST_MARKER_POP_MIN_SCALE = 0.1;
const LIST_MARKER_POP_SCALE_RANGE = 0.9;
const LIST_MARKER_POP_SCALE_SPEED = 2;
const LIST_MARKER_POP_COLOR_SPEED = 2;

export function getEditorAnimationDuration(animation: EditorAnimation) {
  switch (animation.kind) {
    case "active-block-flash":
      return activeBlockFlashDurationMs;
    case "deleted-text-fade":
      return deletedTextFadeDurationMs;
    case "inserted-text-highlight":
      return insertedTextHighlightDurationMs;
    case "list-marker-pop":
      return listMarkerPopDurationMs;
    case "punctuation-pulse":
      return punctuationPulseDurationMs;
  }
}

export function hasRunningEditorAnimations(state: EditorState, now?: number) {
  const animationTime = now ?? getEditorAnimationTime();

  return state.animations.some(
    (animation) => animationTime - animation.startedAt < getEditorAnimationDuration(animation),
  );
}

export function resolveActiveInsertedTextHighlights(state: EditorState, now: number) {
  return collectActiveAnimations<
    "inserted-text-highlight",
    InsertedTextHighlightAnimation,
    ActiveInsertedTextHighlight
  >(state, now, "inserted-text-highlight", (a) => a.regionPath);
}

export function resolveActiveBlockFlashes(state: EditorState, now: number) {
  return collectActiveAnimation<"active-block-flash", ActiveBlockFlashAnimation, ActiveBlockFlash>(
    state,
    now,
    "active-block-flash",
    (a) => a.blockPath,
  );
}

export function resolveActiveDeletedTextFades(state: EditorState, now: number) {
  return collectActiveAnimations<
    "deleted-text-fade",
    DeletedTextFadeAnimation,
    ActiveDeletedTextFade
  >(state, now, "deleted-text-fade", (a) => a.regionPath);
}

export function resolveActivePunctuationPulses(state: EditorState, now: number) {
  return collectActiveAnimations<
    "punctuation-pulse",
    PunctuationPulseAnimation,
    ActivePunctuationPulse
  >(state, now, "punctuation-pulse", (a) => a.regionPath);
}

export function resolveActiveListMarkerPops(state: EditorState, now: number) {
  return collectActiveAnimation<"list-marker-pop", ListMarkerPopAnimation, ActiveListMarkerPop>(
    state,
    now,
    "list-marker-pop",
    (a) => a.blockPath,
  );
}

export function resolveInsertHighlightSegmentBoundaries(
  startOffset: number,
  endOffset: number,
  insertedTextHighlights: ActiveInsertedTextHighlight[],
) {
  const boundaries = new Set<number>([startOffset, endOffset]);

  for (const highlight of insertedTextHighlights) {
    if (highlight.endOffset <= startOffset || highlight.startOffset >= endOffset) {
      continue;
    }

    boundaries.add(Math.max(startOffset, highlight.startOffset));
    boundaries.add(Math.min(endOffset, highlight.endOffset));
  }

  return [...boundaries].sort((left, right) => left - right);
}

export function resolveActiveInsertedTextHighlightForSegment(
  insertedTextHighlights: ActiveInsertedTextHighlight[],
  startOffset: number,
  endOffset: number,
) {
  return (
    insertedTextHighlights.find(
      (highlight) => highlight.startOffset < endOffset && highlight.endOffset > startOffset,
    ) ?? null
  );
}

export function resolveAnimatedTextColor(
  baseColor: string,
  insertedTextHighlight: ActiveInsertedTextHighlight | null,
  theme: EditorTheme,
) {
  if (!insertedTextHighlight) {
    return baseColor;
  }

  return blendCanvasColors(theme.insertHighlightText, baseColor, insertedTextHighlight.progress);
}

export function resolveDeletedTextFadeColor(
  baseColor: string,
  deletedTextFade: ActiveDeletedTextFade,
) {
  return blendCanvasColors(baseColor, transparentCanvasColor, deletedTextFade.progress);
}

export function resolveActiveBlockFlashColor(
  activeBlockFlashColor: string,
  activeBlockFlash: ActiveBlockFlash,
) {
  return blendCanvasColors(activeBlockFlashColor, transparentCanvasColor, activeBlockFlash.progress);
}

export function resolvePunctuationPulseColor(
  punctuationPulse: ActivePunctuationPulse,
  theme: EditorTheme,
) {
  return blendCanvasColors(
    theme.insertHighlightText,
    transparentCanvasColor,
    punctuationPulse.progress,
  );
}

export function resolveListMarkerPopScale(pop: ActiveListMarkerPop) {
  const scaleProgress = Math.min(1, pop.progress * LIST_MARKER_POP_SCALE_SPEED);
  return LIST_MARKER_POP_MIN_SCALE + LIST_MARKER_POP_SCALE_RANGE * easeOutCubic(scaleProgress);
}

export function resolveListMarkerPopColor(
  baseColor: string,
  pop: ActiveListMarkerPop,
  theme: EditorTheme,
) {
  const colorProgress = Math.max(0, pop.progress * LIST_MARKER_POP_COLOR_SPEED - 1);
  return blendCanvasColors(theme.insertHighlightText, baseColor, colorProgress);
}

// Resolves active animations of a given kind into a keyed map of arrays,
// filtering expired animations and computing normalized progress for each.
function collectActiveAnimations<
  TKind extends EditorAnimation["kind"],
  TAnimation extends Extract<EditorAnimation, { kind: TKind }>,
  TActive extends TAnimation & { progress: number },
>(
  state: EditorState,
  now: number,
  kind: TKind,
  getKey: (animation: TAnimation) => string,
): Map<string, TActive[]> {
  const result = new Map<string, TActive[]>();

  for (const animation of state.animations) {
    if (animation.kind !== kind) {
      continue;
    }

    const durationMs = getEditorAnimationDuration(animation);
    const elapsed = now - animation.startedAt;

    if (elapsed >= durationMs) {
      continue;
    }

    const active = {
      ...animation,
      progress: Math.max(0, Math.min(1, elapsed / durationMs)),
    } as unknown as TActive;
    const key = getKey(animation as TAnimation);
    const existing = result.get(key);

    if (existing) {
      existing.push(active);
    } else {
      result.set(key, [active]);
    }
  }

  return result;
}

// Single-value variant: keeps only the latest animation per key.
function collectActiveAnimation<
  TKind extends EditorAnimation["kind"],
  TAnimation extends Extract<EditorAnimation, { kind: TKind }>,
  TActive extends TAnimation & { progress: number },
>(
  state: EditorState,
  now: number,
  kind: TKind,
  getKey: (animation: TAnimation) => string,
): Map<string, TActive> {
  const result = new Map<string, TActive>();

  for (const animation of state.animations) {
    if (animation.kind !== kind) {
      continue;
    }

    const durationMs = getEditorAnimationDuration(animation);
    const elapsed = now - animation.startedAt;

    if (elapsed >= durationMs) {
      continue;
    }

    result.set(getKey(animation as TAnimation), {
      ...animation,
      progress: Math.max(0, Math.min(1, elapsed / durationMs)),
    } as unknown as TActive);
  }

  return result;
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

function getEditorAnimationTime() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
