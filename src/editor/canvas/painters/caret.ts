// Owns caret painting on the overlay canvas. The user caret is suppressed when
// a range selection exists (the selection highlight on the content canvas
// stands in for it); presence carets always draw.

import type { EditorPresence } from "../../anchors";
import {
  findLineForRegionOffset,
  measureCaretTarget,
  resolveCaretVisualLeft,
  type DocumentLayout,
} from "../../layout";
import type { EditorState } from "../../state";
import type { EditorTheme } from "@/types";
import type { CanvasSelectionRange } from "..";
import { resolveCanvasCenteredTextTop, resolveCanvasFontMetrics } from "../lib/fonts";

const caretOpticalTopInset = 1;
const caretStrokeWidth = 2;
const caretVerticalInset = 2;

export function paintCanvasCaretOverlay({
  context,
  devicePixelRatio,
  editorState,
  height,
  layout,
  normalizedSelection,
  presence,
  showCaret,
  theme,
  viewportTop,
  width,
}: {
  context: CanvasRenderingContext2D;
  devicePixelRatio: number;
  editorState: EditorState;
  height: number;
  layout: DocumentLayout;
  normalizedSelection: CanvasSelectionRange;
  presence?: EditorPresence[];
  showCaret: boolean;
  theme: EditorTheme;
  viewportTop: number;
  width: number;
}) {
  context.save();
  context.scale(devicePixelRatio, devicePixelRatio);
  context.clearRect(0, 0, width, height);

  const hasRangeSelection =
    normalizedSelection.start.regionId === normalizedSelection.end.regionId &&
    normalizedSelection.start.offset !== normalizedSelection.end.offset;
  const shouldPaintUserCaret = showCaret && !hasRangeSelection;

  context.translate(0, -viewportTop);

  if (shouldPaintUserCaret) {
    paintCanvasCaret(context, editorState, layout, {
      color: theme.caret,
      offset: editorState.selection.focus.offset,
      regionId: editorState.selection.focus.regionId,
    });
  }

  if (presence) {
    for (const presenceItem of presence) {
      if (!presenceItem.cursorPoint) {
        continue;
      }

      paintCanvasCaret(context, editorState, layout, {
        color: presenceItem.color ?? theme.leafAccent,
        offset: presenceItem.cursorPoint.offset,
        regionId: presenceItem.cursorPoint.regionId,
      });
    }
  }

  context.restore();
}

function paintCanvasCaret(
  context: CanvasRenderingContext2D,
  editorState: EditorState,
  layout: DocumentLayout,
  target: {
    color: string;
    offset: number;
    regionId: string;
  },
) {
  const caret = measureCaretTarget(layout, editorState.documentIndex, {
    regionId: target.regionId,
    offset: target.offset,
  });

  if (!caret) {
    return;
  }

  const caretLeft = resolveCaretVisualLeft(editorState, layout, caret);
  const metrics = resolveCanvasCaretPaintMetrics(layout, caret);

  context.fillStyle = target.color;
  context.fillRect(caretLeft, metrics.top, caretStrokeWidth, metrics.height);
}

function resolveCanvasCaretPaintMetrics(
  layout: DocumentLayout,
  caret: NonNullable<ReturnType<typeof measureCaretTarget>>,
) {
  const line = findLineForRegionOffset(layout, caret.regionId, caret.offset);
  const font = line?.font ?? '16px "Iowan Old Style", "Palatino Linotype", serif';
  const { ascent, descent } = resolveCanvasFontMetrics(font);
  const glyphHeight = Math.max(1, ascent + descent);
  const height = Math.min(caret.height - caretVerticalInset, glyphHeight);
  const top = line
    ? Math.max(
        line.top,
        line.top + resolveCanvasCenteredTextTop(line.height, font) - caretOpticalTopInset,
      )
    : caret.top + Math.max(0, Math.floor((caret.height - height) / 2));

  return {
    height,
    top,
  };
}
