// Owns per-line block backgrounds (code fence fill and table cell chrome),
// active-block and document-change tints, and active-block change effects.

import type { LayoutRect } from "@/editor/layout";
import type { ResolvedEditorTheme } from "../../theme";
import type { EffectEnvironment, PaintEffect } from "../../effects";
import { fadeCanvasColor } from "../../effects/colors";
import type { ActiveBlockChangedEffectFrame, DocumentFrameLine } from "../../frame";
import { paintHighlight } from "../highlights";
import { paintGridCellChrome } from "../table";

export function paintLineContainerBackground(
  context: CanvasRenderingContext2D,
  lineFrame: DocumentFrameLine,
  theme: ResolvedEditorTheme,
) {
  const background = lineFrame.containerBackground;

  if (!background) {
    return;
  }

  if (background.kind === "code") {
    context.fillStyle = theme.codeBackground;
    paintRect(context, background.rect);
    return;
  }

  paintGridCellChrome(context, background.rect, background.isHeaderRow, theme);
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
  if (!effect?.activeFlash) {
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
        borderColor: effect.geometry.borderRect ? theme.tableBorder : undefined,
        fill: fadeCanvasColor(theme.activeBlockFlash, progress),
      });
    },
  );
}

function paintRect(context: CanvasRenderingContext2D, rect: LayoutRect) {
  context.fillRect(rect.left, rect.top, rect.width, rect.height);
}
