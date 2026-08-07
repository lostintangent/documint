import type { LayoutRect } from "@/editor/layout";
import type { ResolvedEditorTheme } from "@/types";
import {
  resolveActiveBlockFlashColor,
  type EffectEnvironment,
  type PaintEffect,
} from "../../effects";
import type { ActiveBlockChangedEffectFrame, DocumentFrameLine } from "../../frame";
import { createRectBandedGeometryFrame } from "../../frame/banded-geometry";
import { paintHighlight } from "../highlights";
import { paintTableCellChrome } from "../table";

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

  paintTableCellChrome(context, background, theme);
}

export function paintActiveBlockBackground(
  lineFrame: DocumentFrameLine,
  environment: EffectEnvironment,
) {
  const { context } = environment;
  const background = lineFrame.activeBlockBackground;

  if (!background) {
    return;
  }

  paintHighlight(context, createRectBandedGeometryFrame(background.rect), {
    fill: background.color,
  });
}

export function paintDocumentChangeBackground(
  lineFrame: DocumentFrameLine,
  environment: EffectEnvironment,
) {
  const { context } = environment;
  const background = lineFrame.documentChangeBackground;

  if (!background) {
    return;
  }

  paintHighlight(context, createRectBandedGeometryFrame(background.rect), {
    fill: background.color,
    opacity: background.opacity,
  });
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
        fill: resolveActiveBlockFlashColor(theme.activeBlockFlash, { progress }),
      });
    },
  );
}

function paintRect(context: CanvasRenderingContext2D, rect: LayoutRect) {
  context.fillRect(rect.left, rect.top, rect.width, rect.height);
}
