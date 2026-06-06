// Renderer entrypoint. The component host creates immutable frame values;
// this module translates those frames into content and overlay canvas pixels.

import {
  paintActiveBlockBackground,
  paintBlockquoteRules,
  paintLineContainerBackground,
  paintHeadingRules,
  paintInertBlock,
} from "./painters/blocks";
import { paintCaretOverlay } from "./painters/caret";
import { paintCommentHighlights } from "./painters/comments";
import { paintListMarker } from "./painters/list";
import { paintSelectionHighlight } from "./painters/selection";
import { paintActiveTableCellHighlight } from "./painters/table";
import {
  paintTextFades,
  paintTextHighlights,
  paintLineText,
  paintTextPulses,
  paintTextDecorationBackgrounds,
  paintTextDecorationOverlays,
} from "./painters/text";
import {
  createDocumentFrame,
  createOverlayFrame,
  type DocumentFrame,
  type DocumentFrameLine,
  type OverlayFrame,
} from "./frame";
import { withPaintLayer } from "./canvas/layer";

export { createDocumentFrame, createOverlayFrame };
export type { DocumentFrame, OverlayFrame };

export function paintDocumentFrame(context: CanvasRenderingContext2D, frame: DocumentFrame): void {
  withPaintLayer(
    context,
    frame.layer,
    () => {
      for (const paintPass of documentPaintPasses) {
        paintPass(context, frame);
      }
    },
    frame.theme.background,
  );
}

type DocumentPaintPass = (context: CanvasRenderingContext2D, frame: DocumentFrame) => void;

const documentPaintPasses: DocumentPaintPass[] = [
  paintContainerBackgroundPass,
  paintInertBlockChromePass,
  paintActiveBlockHighlightPass,
  paintLineForegroundPass,
  paintRulePass,
];

function paintContainerBackgroundPass(context: CanvasRenderingContext2D, frame: DocumentFrame) {
  for (const lineFrame of frame.lines) {
    paintLineContainerBackground(context, lineFrame, frame.theme);
  }
}

function paintInertBlockChromePass(context: CanvasRenderingContext2D, frame: DocumentFrame) {
  paintInertBlock(context, frame.chrome.dividerRules, frame.theme);
}

function paintActiveBlockHighlightPass(context: CanvasRenderingContext2D, frame: DocumentFrame) {
  if (frame.chrome.activeTableCellHighlight) {
    paintActiveTableCellHighlight(context, frame.chrome.activeTableCellHighlight, frame.theme);
  }
}

function paintLineForegroundPass(context: CanvasRenderingContext2D, frame: DocumentFrame) {
  const linePaint: LinePaintContext = {
    clocks: frame.clocks,
    resources: frame.resources,
    theme: frame.theme,
  };

  for (const lineFrame of frame.lines) {
    paintContentLine(context, lineFrame, linePaint);
  }
}

function paintRulePass(context: CanvasRenderingContext2D, frame: DocumentFrame) {
  paintHeadingRules(context, frame.chrome.headingRules, frame.theme);
  paintBlockquoteRules(context, frame.chrome.blockquoteRules, frame.theme);
}

export function paintOverlayFrame(context: CanvasRenderingContext2D, frame: OverlayFrame): void {
  withPaintLayer(context, frame.layer, () => {
    paintCaretOverlay(context, frame.carets);
  });
}

// Per-line foreground sub-pipeline. Intentionally short and linear — each call
// is a single visual concern, ordered by z-stack.
function paintContentLine(
  context: CanvasRenderingContext2D,
  lineFrame: DocumentFrameLine,
  linePaint: LinePaintContext,
) {
  context.font = lineFrame.layoutLine.font;

  for (const paintLineForeground of lineForegroundPainters) {
    paintLineForeground(context, lineFrame, linePaint);
  }
}

type LinePaintContext = {
  clocks: DocumentFrame["clocks"];
  resources: DocumentFrame["resources"];
  theme: DocumentFrame["theme"];
};

type LineForegroundPainter = (
  context: CanvasRenderingContext2D,
  lineFrame: DocumentFrameLine,
  linePaint: LinePaintContext,
) => void;

const lineForegroundPainters: LineForegroundPainter[] = [
  // Active block background.
  (context, lineFrame, linePaint) => {
    paintActiveBlockBackground(context, lineFrame, linePaint.theme);
  },
  // Decoration backgrounds below glyphs.
  (context, lineFrame, linePaint) => {
    if (lineFrame.textDecorations) {
      paintTextDecorationBackgrounds(
        context,
        lineFrame,
        lineFrame.textDecorations,
        linePaint.clocks,
      );
    }
  },
  // Selection highlight.
  (context, lineFrame, linePaint) => {
    paintSelectionHighlight(context, lineFrame, linePaint.theme);
  },
  // Comment highlights.
  (context, lineFrame, linePaint) => {
    paintCommentHighlights(context, lineFrame, linePaint.clocks.ambientAnimation);
  },
  // List marker.
  (context, lineFrame, linePaint) => {
    paintListMarker(context, lineFrame, linePaint.theme);
  },
  // Text and replacement segments.
  (context, lineFrame, linePaint) => {
    paintLineText(context, lineFrame, linePaint);
  },
  // Decoration overlays above glyphs.
  (context, lineFrame, linePaint) => {
    if (lineFrame.textDecorations) {
      paintTextDecorationOverlays(
        context,
        lineFrame,
        lineFrame.textDecorations,
        linePaint.clocks,
      );
    }
  },
  // Insert highlights.
  (context, lineFrame, linePaint) => {
    paintTextHighlights(context, lineFrame, lineFrame.activeTextHighlights, linePaint.theme);
  },
  // Delete fades.
  (context, lineFrame, _linePaint) => {
    paintTextFades(context, lineFrame, lineFrame.activeTextFades);
  },
  // Text pulses.
  (context, lineFrame, linePaint) => {
    paintTextPulses(context, lineFrame, lineFrame.activeTextPulses, linePaint.theme);
  },
];
