// Resolves semantic effects for paint. Editor and host code emit semantic
// effects; this module decides which are active, how long they run, and which
// paint-ready effect groups they contribute to for the current frame.

import type { ResolvedEditorTheme } from "../theme";
import { blendCanvasColors } from "./colors";
import { descriptorFor, type EffectGroups } from "./kinds";
import type { RendererEffect, DocumintEffects } from "./types";

export type { PaintEffect } from "./custom-effects";
export { createPaintEffect } from "./custom-effects";
export type {
  ActiveBlockChangedEffectContext,
  BlockFlashFrame,
  BlockPulseFrame,
  DocumentChangeEffect,
  DocumentChangeFadeFrame,
  DocumintEffectHandler,
  DocumintEffects,
  DocumintListMarkerPaintFrame,
  EffectEnvironment,
  ListItemInsertedEffectContext,
  RendererEffect,
  RendererEffectInput,
  TextDeletedEffectContext,
  TextFadeFrame,
  TextInsertedEffectContext,
  TextInsertionFrame,
} from "./types";

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
  customEffects?: DocumintEffects,
): ResolvedEffects {
  const groups: EffectGroups = {
    blockFlashes: new Map(),
    blockPulses: new Map(),
    documentChangeFades: new Map(),
    textFades: new Map(),
    textHighlights: new Map(),
    textPulses: new Map(),
  };
  const rendererEffects: RendererEffect[] = [];

  for (const effect of effects) {
    const descriptor = descriptorFor(effect);
    const defaultEnabled = descriptor.animatesByDefault?.(effect) ?? true;
    // Effects the defaults skip stay active only for a matching host handler.
    const durationMs =
      defaultEnabled ||
      (descriptor.customHandlerKey && customEffects?.[descriptor.customHandlerKey])
        ? descriptor.duration(effect)
        : null;
    const elapsed = now - effect.startedAt;

    if (durationMs === null || elapsed >= durationMs) {
      continue;
    }

    rendererEffects.push(effect);
    descriptor.collect(
      groups,
      effect,
      Math.max(0, Math.min(1, elapsed / durationMs)),
      defaultEnabled,
    );
  }

  return { ...groups, rendererEffects };
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

function easeOutCubic(t: number) {
  return 1 - (1 - t) * (1 - t) * (1 - t);
}
