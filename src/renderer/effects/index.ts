// Owns paint-time effect policy. The editor emits semantic effects; this
// module decides which effects are active, how long they run, and which
// paint-ready effect groups they contribute to for the current frame.

import type { DocumintEffects, ResolvedEditorTheme } from "@/types";
import type { EditorEffect, TextDeletedEffect, TextInsertedEffect } from "@/editor/state";
import { containsColorEmoji } from "@/editor/text/emoji";
import { blendCanvasColors, transparentCanvasColor } from "./colors";
import type {
  ActiveBlockFlash,
  ActiveBlockPulse,
  ActiveEditorEffect,
  ActiveTextFade,
  ActiveTextHighlight,
  ActiveTextPulse,
} from "./types";

export type { EffectEnvironment } from "@/types";
export type { PaintEffect } from "./custom-effects";
export { createPaintEffect } from "./custom-effects";
export type {
  ActiveBlockFlash,
  ActiveBlockPulse,
  ActiveEditorEffect,
  ActiveTextFade,
  ActiveTextHighlight,
  ActiveTextInsertion,
  ActiveTextPulse,
} from "./types";

export type EffectPolicy = {
  // Return `null` to opt an effect out of default renderer handling.
  // The same policy must be used for frame resolution, pruning, and
  // continuation checks so effect lifetime and painted output stay aligned.
  duration: (effect: EditorEffect) => number | null;
};

const activeBlockChangedDurationMs = 300;
const textDeletedDurationMs = 180;
const textInsertedDurationMs = 1000;
const listItemInsertedDurationMs = 500;
const punctuationInsertedDurationMs = 140;

// Default renderer policy. Hosts can wrap this value to override specific
// effect durations while preserving the built-in behavior for the rest.
export const defaultEffectPolicy: EffectPolicy = {
  duration: getDefaultEffectDuration,
};

export type ActiveEffects = {
  activeEditorEffects: readonly ActiveEditorEffect[];
  blockFlashes: Map<string, ActiveBlockFlash>;
  blockPulses: Map<string, ActiveBlockPulse>;
  textFades: Map<string, ActiveTextFade[]>;
  textHighlights: Map<string, ActiveTextHighlight[]>;
  textPulses: Map<string, ActiveTextPulse[]>;
};

// List marker pop reaches full scale in the first half of its duration,
// then blends color back to the base in the second half.
const LIST_MARKER_POP_MIN_SCALE = 0.1;
const LIST_MARKER_POP_SCALE_RANGE = 0.9;
const LIST_MARKER_POP_SCALE_SPEED = 2;
const LIST_MARKER_POP_COLOR_SPEED = 2;

export function resolveActiveEffects(
  effects: readonly ActiveEditorEffect[],
  now: number,
  policy = defaultEffectPolicy,
  customEffects?: DocumintEffects,
): ActiveEffects {
  const result = createEmptyActiveEffects();
  const activeEditorEffects: ActiveEditorEffect[] = [];

  for (const effect of effects) {
    const progress = resolveEffectProgress(effect, now, policy, customEffects);

    if (progress === null) {
      continue;
    }

    activeEditorEffects.push(effect);
    collectActiveEffect(result, effect, progress);
  }

  return { ...result, activeEditorEffects };
}

export function resolveTextFadeColor(baseColor: string, textFade: ActiveTextFade) {
  return blendCanvasColors(baseColor, transparentCanvasColor, textFade.progress);
}

export function resolveActiveBlockFlashColor(
  activeBlockFlashColor: string,
  activeBlockFlash: { progress: number },
) {
  return blendCanvasColors(
    activeBlockFlashColor,
    transparentCanvasColor,
    activeBlockFlash.progress,
  );
}

export function resolveTextPulseColor(textPulse: ActiveTextPulse, theme: ResolvedEditorTheme) {
  return blendCanvasColors(theme.insertHighlightText, transparentCanvasColor, textPulse.progress);
}

export function resolveBlockPulseScale(pop: { progress: number }) {
  const scaleProgress = Math.min(1, pop.progress * LIST_MARKER_POP_SCALE_SPEED);
  return LIST_MARKER_POP_MIN_SCALE + LIST_MARKER_POP_SCALE_RANGE * easeOutCubic(scaleProgress);
}

export function resolveBlockPulseColor(
  baseColor: string,
  pop: { progress: number },
  theme: ResolvedEditorTheme,
) {
  const colorProgress = Math.max(0, pop.progress * LIST_MARKER_POP_COLOR_SPEED - 1);
  return blendCanvasColors(theme.insertHighlightText, baseColor, colorProgress);
}

function createEmptyActiveEffects(): Omit<ActiveEffects, "activeEditorEffects"> {
  return {
    blockFlashes: new Map(),
    blockPulses: new Map(),
    textFades: new Map(),
    textHighlights: new Map(),
    textPulses: new Map(),
  };
}

function collectMany<TEffect>(
  result: Map<string, TEffect[]>,
  key: string,
  item: TEffect,
) {
  const existing = result.get(key);

  if (existing) {
    existing.push(item);
  } else {
    result.set(key, [item]);
  }
}

function collectActiveEffect(
  result: Omit<ActiveEffects, "activeEditorEffects">,
  effect: ActiveEditorEffect,
  progress: number,
) {
  switch (effect.kind) {
    case "active-block-changed":
      result.blockFlashes.set(effect.blockPath, {
        blockPath: effect.blockPath,
        progress,
      });
      return;
    case "list-item-inserted":
      result.blockPulses.set(effect.blockPath, {
        blockPath: effect.blockPath,
        progress,
      });
      return;
    case "text-deleted":
      collectMany(result.textFades, effect.regionPath, {
        progress,
        regionPath: effect.regionPath,
        startOffset: effect.startOffset,
        text: effect.text,
      });
      return;
    case "text-inserted":
      if (effect.text === ".") {
        collectMany(result.textPulses, effect.regionPath, {
          endOffset: effect.endOffset,
          offset: effect.startOffset,
          progress,
          regionPath: effect.regionPath,
          startOffset: effect.startOffset,
          text: effect.text,
        });
        return;
      }

      collectMany(result.textHighlights, effect.regionPath, {
        endOffset: effect.endOffset,
        progress,
        regionPath: effect.regionPath,
        startOffset: effect.startOffset,
        text: effect.text,
      });
      return;
  }
}

function resolveEffectProgress(
  effect: ActiveEditorEffect,
  now: number,
  policy: EffectPolicy,
  customEffects?: DocumintEffects,
): number | null {
  const durationMs = policy.duration(effect) ?? getCustomEffectDuration(effect, customEffects);

  if (durationMs === null) {
    return null;
  }

  const elapsed = now - effect.startedAt;

  if (elapsed >= durationMs) {
    return null;
  }

  return Math.max(0, Math.min(1, elapsed / durationMs));
}

function getDefaultEffectDuration(effect: EditorEffect): number | null {
  switch (effect.kind) {
    case "active-block-changed":
      return activeBlockChangedDurationMs;
    case "text-deleted":
      if (!shouldAnimateTextDeletedEffect(effect)) {
        return null;
      }

      return textDeletedDurationMs;
    case "text-inserted":
      if (!shouldAnimateTextInsertedEffect(effect)) {
        return null;
      }

      return effect.text === "." ? punctuationInsertedDurationMs : textInsertedDurationMs;
    case "list-item-inserted":
      return listItemInsertedDurationMs;
  }
}

function getCustomEffectDuration(
  effect: EditorEffect,
  customEffects: DocumintEffects | undefined,
): number | null {
  if (!hasCustomEffectHandler(effect, customEffects)) {
    return null;
  }

  switch (effect.kind) {
    case "active-block-changed":
      return activeBlockChangedDurationMs;
    case "text-deleted":
      return textDeletedDurationMs;
    case "text-inserted":
      return effect.text === "." ? punctuationInsertedDurationMs : textInsertedDurationMs;
    case "list-item-inserted":
      return listItemInsertedDurationMs;
  }
}

function hasCustomEffectHandler(
  effect: EditorEffect,
  customEffects: DocumintEffects | undefined,
) {
  switch (effect.kind) {
    case "active-block-changed":
      return Boolean(customEffects?.activeBlockChanged);
    case "text-deleted":
      return Boolean(customEffects?.textDeleted);
    case "text-inserted":
      return Boolean(customEffects?.textInserted);
    case "list-item-inserted":
      return Boolean(customEffects?.listItemInserted);
  }
}

function shouldAnimateTextDeletedEffect(effect: TextDeletedEffect) {
  return (
    effect.direction === "backward" &&
    effect.textKind === "plain" &&
    effect.placement !== "line-middle" &&
    !containsColorEmoji(effect.text)
  );
}

function shouldAnimateTextInsertedEffect(effect: TextInsertedEffect) {
  return !containsColorEmoji(effect.text);
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) * (1 - t) * (1 - t);
}
