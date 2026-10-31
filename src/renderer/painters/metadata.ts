// Paints prepared metadata layout geometry without introducing a parallel
// renderer-frame model.

import type { MetadataLayout } from "@/editor/layout";
import { TABLE_CELL_PADDING_X } from "@/editor/layout/measure/table";
import { resolvePlainTextFont } from "@/editor/text/fonts";
import type { ResolvedEditorTheme } from "../theme";
import { paintCheckbox } from "./checkbox";
import { paintGridCellChrome } from "./table";

const HEADER_CHEVRON_STROKE_WIDTH = 1.5;

export function paintMetadataBackgrounds(
  context: CanvasRenderingContext2D,
  metadata: MetadataLayout | null,
  theme: ResolvedEditorTheme,
) {
  if (!metadata) {
    return;
  }

  paintGridCellChrome(context, metadata.header, true, theme);

  for (const row of metadata.rows) {
    paintGridCellChrome(context, row.keyRect, true, theme);
    paintGridCellChrome(context, row.valueRect, false, theme);
  }
}

export function paintMetadataForeground(
  context: CanvasRenderingContext2D,
  metadata: MetadataLayout | null,
  theme: ResolvedEditorTheme,
) {
  if (!metadata) {
    return;
  }

  context.save();

  paintMetadataHeader(context, metadata, theme);

  for (const row of metadata.rows) {
    if (row.checkbox) {
      paintCheckbox(context, row.checkbox, theme);
    }
  }

  context.restore();
}

function paintMetadataHeader(
  context: CanvasRenderingContext2D,
  metadata: MetadataLayout,
  theme: ResolvedEditorTheme,
) {
  const rect = metadata.header;
  const chevronSize = Math.max(6, Math.round(theme.fontSize * 0.5));
  const chevronLeft = rect.left + rect.width - TABLE_CELL_PADDING_X - chevronSize;
  const chevronCenterY = rect.top + rect.height / 2;

  context.strokeStyle = theme.headingText;
  context.lineWidth = HEADER_CHEVRON_STROKE_WIDTH;
  context.beginPath();

  if (metadata.expanded) {
    context.moveTo(chevronLeft, chevronCenterY + chevronSize / 4);
    context.lineTo(chevronLeft + chevronSize / 2, chevronCenterY - chevronSize / 4);
    context.lineTo(chevronLeft + chevronSize, chevronCenterY + chevronSize / 4);
  } else {
    context.moveTo(chevronLeft, chevronCenterY - chevronSize / 4);
    context.lineTo(chevronLeft + chevronSize / 2, chevronCenterY + chevronSize / 4);
    context.lineTo(chevronLeft + chevronSize, chevronCenterY - chevronSize / 4);
  }

  context.stroke();

  const labelFont = resolvePlainTextFont(theme.fontSize);
  context.fillStyle = theme.headingText;
  context.font = labelFont;
  context.textAlign = "left";
  context.fillText(
    "Document metadata",
    rect.left + TABLE_CELL_PADDING_X,
    resolveMetadataHeaderBaseline(context, rect, "Document metadata"),
  );
}

function resolveMetadataHeaderBaseline(
  context: CanvasRenderingContext2D,
  rect: MetadataLayout["header"],
  text: string,
) {
  const metrics = context.measureText(text);
  return (
    rect.top +
    rect.height / 2 +
    (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2
  );
}
