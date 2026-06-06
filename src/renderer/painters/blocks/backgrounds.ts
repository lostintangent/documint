import type { LayoutRect } from "@/editor/layout";
import type { ResolvedEditorTheme } from "@/types";
import { resolveActiveBlockFlashColor, type ActiveBlockFlash } from "../../animations";
import type { DocumentFrameLine } from "../../frame";
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
  context: CanvasRenderingContext2D,
  lineFrame: DocumentFrameLine,
  theme: ResolvedEditorTheme,
) {
  const background = lineFrame.activeBlockBackground;

  if (!background) {
    return;
  }

  paintActiveBlockRect(context, background.rect, background.activeFlash, theme);
}

function paintActiveBlockRect(
  context: CanvasRenderingContext2D,
  rect: LayoutRect,
  activeBlockFlash: ActiveBlockFlash | null,
  theme: ResolvedEditorTheme,
) {
  context.fillStyle = theme.activeBlockBackground;
  context.fillRect(rect.left, rect.top, rect.width, rect.height);

  if (!activeBlockFlash) {
    return;
  }

  context.fillStyle = resolveActiveBlockFlashColor(theme.activeBlockFlash, activeBlockFlash);
  context.fillRect(rect.left, rect.top, rect.width, rect.height);
}

function paintRect(context: CanvasRenderingContext2D, rect: LayoutRect) {
  context.fillRect(rect.left, rect.top, rect.width, rect.height);
}
