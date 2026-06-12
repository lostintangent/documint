// Owns paint-time effect policy. The editor emits semantic effects; this
// module decides which effects are active, how long they run, and which
// paint-ready effect groups they contribute to for the current frame.

import type { DocumintEffects, ResolvedEditorTheme } from "@/types";
import type { EditorEffect } from "@/editor/state";
import { blendCanvasColors, transparentCanvasColor } from "./colors";
import { descriptorFor, type ActiveEffectGroups } from "./kinds";
import type {
  ActiveEditorEffect,
  ActiveTextFade,
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

// Default renderer policy. Hosts can wrap this value to override specific
// effect durations while preserving the built-in behavior for the rest.
export const defaultEffectPolicy: EffectPolicy = {
  duration: (effect) => {
    const descriptor = descriptorFor(effect);
    return descriptor.animatesByDefault(effect) ? descriptor.duration(effect) : null;
  },
};

export type ActiveEffects = ActiveEffectGroups & {
  activeEditorEffects: readonly ActiveEditorEffect[];
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
    descriptorFor(effect).collect(result, effect, progress);
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

function createEmptyActiveEffects(): ActiveEffectGroups {
  return {
    blockFlashes: new Map(),
    blockPulses: new Map(),
    textFades: new Map(),
    textHighlights: new Map(),
    textPulses: new Map(),
  };
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

function getCustomEffectDuration(
  effect: EditorEffect,
  customEffects: DocumintEffects | undefined,
): number | null {
  const descriptor = descriptorFor(effect);
  return customEffects?.[descriptor.customHandlerKey] ? descriptor.duration(effect) : null;
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) * (1 - t) * (1 - t);
}
