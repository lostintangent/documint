// Owns block backgrounds: the code block surface, active-block and
// document-change tints, and active-block change effects.

import type { LayoutRect } from "@/editor/layout";
import type { ResolvedEditorTheme } from "../../theme";
import type { EffectEnvironment, PaintEffect } from "../../effects";
import { fadeCanvasColor } from "../../effects/colors";
import type { ActiveBlockChangedEffectFrame } from "../../frame";
import { paintHighlight } from "../highlights";

export function paintCodeBlockSurface(
  context: CanvasRenderingContext2D,
  rect: LayoutRect,
  theme: ResolvedEditorTheme,
) {
  context.fillStyle = theme.codeBackground;
  context.fillRect(rect.left, rect.top, rect.width, rect.height);
}

// Active-block and document-change backgrounds share one shape: a solid rect
// with optional fade opacity.
export function paintBlockBackground(
  context: CanvasRenderingContext2D,
  background: { color: string; opacity?: number; rect: LayoutRect } | null,
) {
  if (!background) {
    return;
  }

  paintHighlight(
    context,
    { bands: [background.rect], rect: background.rect },
    {
      fill: background.color,
      opacity: background.opacity,
    },
  );
}

export function paintActiveBlockChangedEffect(
  effect: ActiveBlockChangedEffectFrame | null,
  environment: EffectEnvironment & { paintEffect: PaintEffect },
) {
  if (!effect) {
    return;
  }

  const { context, paintEffect } = environment;
  paintEffect(
    effect.activeFlash,
    {
      progress: effect.activeFlash.progress,
      rect: effect.geometry.rect,
    },
    ({ progress, theme }) => {
      paintHighlight(context, effect.geometry, {
        borderColor: theme.tableBorder,
        fill: fadeCanvasColor(theme.activeBlockFlash, progress),
      });
    },
  );
}
