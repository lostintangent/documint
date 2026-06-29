// Owns paint-time effect policy. Editor and host code emit semantic effects;
// this module decides which effects are active, how long they run, and which
// paint-ready effect groups they contribute to for the current frame.

import type { DocumintEffects, ResolvedEditorTheme } from "@/types";
import { blendCanvasColors, transparentCanvasColor } from "./colors";
import { descriptorFor, type EffectGroups } from "./kinds";
import type { RendererEffect, TextFadeFrame, TextPulseFrame } from "./types";

export type { EffectEnvironment } from "@/types";
export type { PaintEffect } from "./custom-effects";
export { createPaintEffect } from "./custom-effects";
export type {
  BlockFlashFrame,
  BlockPulseFrame,
  DocumentChangeEffect,
  DocumentChangeFadeFrame,
  RendererEffect,
  RendererEffectInput,
  TextFadeFrame,
  TextHighlightFrame,
  TextPulseFrame,
} from "./types";

export type EffectPolicy = {
  // Return `null` to opt an effect out of default renderer handling.
  // The same policy must be used for frame resolution, pruning, and
  // continuation checks so effect lifetime and painted output stay aligned.
  duration: (effect: RendererEffect) => number | null;
};

// Default renderer policy. Hosts can wrap this value to override specific
// effect durations while preserving the built-in behavior for the rest.
export const defaultEffectPolicy: EffectPolicy = {
  duration: (effect) => {
    const descriptor = descriptorFor(effect);
    return descriptor.animatesByDefault(effect) ? descriptor.duration(effect) : null;
  },
};

export type ResolvedEffects = EffectGroups & {
  rendererEffects: readonly RendererEffect[];
};

// List marker pop reaches full scale in the first half of its duration,
// then blends color back to the base in the second half.
const LIST_MARKER_POP_MIN_SCALE = 0.1;
const LIST_MARKER_POP_SCALE_RANGE = 0.9;
const LIST_MARKER_POP_SCALE_SPEED = 2;
const LIST_MARKER_POP_COLOR_SPEED = 2;

export function resolveRendererEffects(
  effects: readonly RendererEffect[],
  now: number,
  policy = defaultEffectPolicy,
  customEffects?: DocumintEffects,
): ResolvedEffects {
  const result = createEmptyResolvedEffects();
  const rendererEffects: RendererEffect[] = [];

  for (const effect of effects) {
    const defaultDurationMs = policy.duration(effect);
    const durationMs = defaultDurationMs ?? getCustomEffectDuration(effect, customEffects);

    if (durationMs === null) {
      continue;
    }

    const progress = resolveEffectProgress(effect, now, durationMs);
    if (progress === null) {
      continue;
    }

    rendererEffects.push(effect);
    descriptorFor(effect).collect(result, effect, progress, defaultDurationMs !== null);
  }

  return { ...result, rendererEffects };
}

export function resolveTextFadeColor(baseColor: string, textFade: TextFadeFrame) {
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

export function resolveTextPulseColor(textPulse: TextPulseFrame, theme: ResolvedEditorTheme) {
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

function createEmptyResolvedEffects(): EffectGroups {
  return {
    blockFlashes: new Map(),
    blockPulses: new Map(),
    documentChangeFades: new Map(),
    textFades: new Map(),
    textHighlights: new Map(),
    textPulses: new Map(),
  };
}

function resolveEffectProgress(
  effect: RendererEffect,
  now: number,
  durationMs: number,
): number | null {
  const elapsed = now - effect.startedAt;

  if (elapsed >= durationMs) {
    return null;
  }

  return Math.max(0, Math.min(1, elapsed / durationMs));
}

function getCustomEffectDuration(effect: RendererEffect, customEffects: DocumintEffects | undefined) {
  const descriptor = descriptorFor(effect);
  return descriptor.customHandlerKey && customEffects?.[descriptor.customHandlerKey]
    ? descriptor.duration(effect)
    : null;
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) * (1 - t) * (1 - t);
}
