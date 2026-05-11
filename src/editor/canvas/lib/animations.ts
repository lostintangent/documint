// Owns paint-time animation helpers. The editor model stores transient effect
// state; this module turns that state into render-local data and color blends
// that the main paint orchestrator can apply while drawing text.

import type { EditorTheme } from "@/types";
import type {
  ActiveBlockFlashAnimation,
  TextFadeAnimation,
  EditorState,
  EditorAnimation,
  TextHighlightAnimation,
  BlockPulseAnimation,
  TextPulseAnimation,
} from "../../state";
import { blendCanvasColors, transparentCanvasColor } from "./colors";

export type ActiveBlockFlash = ActiveBlockFlashAnimation & {
  progress: number;
};

export type ActiveTextFade = TextFadeAnimation & {
  progress: number;
};

export type ActiveTextHighlight = TextHighlightAnimation & {
  progress: number;
};

export type ActiveBlockPulse = BlockPulseAnimation & {
  progress: number;
};

export type ActiveTextPulse = TextPulseAnimation & {
  progress: number;
};

const activeBlockFlashDurationMs = 300;
const textFadeDurationMs = 180;
const textHighlightDurationMs = 1000;
const blockPulseDurationMs = 500;
const textPulseDurationMs = 140;

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

export function resolveActiveTextHighlights(state: EditorState, now: number) {
  return collectActiveAnimations<
    "text-highlight",
    TextHighlightAnimation,
    ActiveTextHighlight
  >(state, now, "text-highlight", (a) => a.regionPath);
}

export function resolveActiveBlockFlashes(state: EditorState, now: number) {
  return collectActiveAnimation<"active-block-flash", ActiveBlockFlashAnimation, ActiveBlockFlash>(
    state,
    now,
    "active-block-flash",
    (a) => a.blockPath,
  );
}

export function resolveActiveTextFades(state: EditorState, now: number) {
  return collectActiveAnimations<
    "text-fade",
    TextFadeAnimation,
    ActiveTextFade
  >(state, now, "text-fade", (a) => a.regionPath);
}

export function resolveActiveTextPulses(state: EditorState, now: number) {
  return collectActiveAnimations<
    "text-pulse",
    TextPulseAnimation,
    ActiveTextPulse
  >(state, now, "text-pulse", (a) => a.regionPath);
}

export function resolveActiveBlockPulses(state: EditorState, now: number) {
  return collectActiveAnimation<"block-pulse", BlockPulseAnimation, ActiveBlockPulse>(
    state,
    now,
    "block-pulse",
    (a) => a.blockPath,
  );
}

export function resolveTextHighlightSegmentBoundaries(
  startOffset: number,
  endOffset: number,
  textHighlights: ActiveTextHighlight[],
) {
  const boundaries = new Set<number>([startOffset, endOffset]);

  for (const highlight of textHighlights) {
    if (highlight.endOffset <= startOffset || highlight.startOffset >= endOffset) {
      continue;
    }

    boundaries.add(Math.max(startOffset, highlight.startOffset));
    boundaries.add(Math.min(endOffset, highlight.endOffset));
  }

  return [...boundaries].sort((left, right) => left - right);
}

export function resolveActiveTextHighlightForSegment(
  textHighlights: ActiveTextHighlight[],
  startOffset: number,
  endOffset: number,
) {
  return (
    textHighlights.find(
      (highlight) => highlight.startOffset < endOffset && highlight.endOffset > startOffset,
    ) ?? null
  );
}

export function resolveAnimatedTextColor(
  baseColor: string,
  textHighlight: ActiveTextHighlight | null,
  theme: EditorTheme,
) {
  if (!textHighlight) {
    return baseColor;
  }

  return blendCanvasColors(theme.insertHighlightText, baseColor, textHighlight.progress);
}

export function resolveTextFadeColor(
  baseColor: string,
  textFade: ActiveTextFade,
) {
  return blendCanvasColors(baseColor, transparentCanvasColor, textFade.progress);
}

export function resolveActiveBlockFlashColor(
  activeBlockFlashColor: string,
  activeBlockFlash: ActiveBlockFlash,
) {
  return blendCanvasColors(
    activeBlockFlashColor,
    transparentCanvasColor,
    activeBlockFlash.progress,
  );
}

export function resolveTextPulseColor(
  textPulse: ActiveTextPulse,
  theme: EditorTheme,
) {
  return blendCanvasColors(
    theme.insertHighlightText,
    transparentCanvasColor,
    textPulse.progress,
  );
}

export function resolveBlockPulseScale(pop: ActiveBlockPulse) {
  const scaleProgress = Math.min(1, pop.progress * LIST_MARKER_POP_SCALE_SPEED);
  return LIST_MARKER_POP_MIN_SCALE + LIST_MARKER_POP_SCALE_RANGE * easeOutCubic(scaleProgress);
}

export function resolveBlockPulseColor(
  baseColor: string,
  pop: ActiveBlockPulse,
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
