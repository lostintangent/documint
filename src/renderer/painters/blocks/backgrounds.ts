import type { LayoutRect } from "@/editor/layout";
import type { ResolvedEditorTheme } from "@/types";
import {
  resolveActiveBlockFlashColor,
  type EffectEnvironment,
  type PaintEffect,
} from "../../effects";
import type { ActiveBlockChangedEffectFrame, DocumentFrameLine } from "../../frame";
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
  const { context, theme } = environment;
  const background = lineFrame.activeBlockBackground;

  if (!background) {
    return;
  }

  context.fillStyle = theme.activeBlockBackground;
  context.fillRect(
    background.rect.left,
    background.rect.top,
    background.rect.width,
    background.rect.height,
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
      rect: effect.rect,
    },
    ({ progress, theme }) => {
      paintBlockFlashFrame(context, effect.bands, progress, theme);

      if (effect.borderRect) {
        context.strokeStyle = theme.tableBorder;
        context.strokeRect(
          effect.borderRect.left,
          effect.borderRect.top,
          effect.borderRect.width,
          effect.borderRect.height,
        );
      }
    },
  );
}

function paintBlockFlashFrame(
  context: CanvasRenderingContext2D,
  bands: readonly LayoutRect[],
  progress: number,
  theme: ResolvedEditorTheme,
) {
  context.fillStyle = resolveActiveBlockFlashColor(theme.activeBlockFlash, { progress });

  for (const band of bands) {
    context.fillRect(band.left, band.top, band.width, band.height);
  }
}

function paintRect(context: CanvasRenderingContext2D, rect: LayoutRect) {
  context.fillRect(rect.left, rect.top, rect.width, rect.height);
}
