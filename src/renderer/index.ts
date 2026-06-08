// Renderer entrypoint. The component host creates immutable frame values;
// this module translates those frames into content and overlay canvas pixels.

import {
  paintActiveBlockBackground,
  paintActiveBlockChangedEffect,
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
import {
  createPaintEffect,
  type EffectEnvironment,
  type PaintEffect,
} from "./effects";

export { createDocumentFrame, createOverlayFrame };
export type { ActiveEditorEffect } from "./effects";
export type { DocumentFrame, OverlayFrame };

export function paintDocumentFrame(context: CanvasRenderingContext2D, frame: DocumentFrame): void {
  paintLayer(
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
  const baseEnvironment: EffectEnvironment = {
    context,
    theme: frame.theme,
    viewport: frame.viewport,
  };
  const environment: DocumentFrameEnvironment = {
    ...baseEnvironment,
    clocks: frame.clocks,
    paintEffect: createPaintEffect(baseEnvironment, frame.customEffects),
    resources: frame.resources,
  };

  for (const lineFrame of frame.lines) {
    paintActiveBlockBackground(lineFrame, environment);
  }

  paintActiveBlockChangedEffect(frame.activeBlockChangedEffect, environment);

  for (const lineFrame of frame.lines) {
    paintContentLine(context, lineFrame, environment);
  }
}

function paintRulePass(context: CanvasRenderingContext2D, frame: DocumentFrame) {
  paintHeadingRules(context, frame.chrome.headingRules, frame.theme);
  paintBlockquoteRules(context, frame.chrome.blockquoteRules, frame.theme);
}

export function paintOverlayFrame(context: CanvasRenderingContext2D, frame: OverlayFrame): void {
  paintLayer(context, frame.layer, () => {
    paintCaretOverlay(context, frame.carets);
  });
}

function paintLayer(
  context: CanvasRenderingContext2D,
  layer: DocumentFrame["layer"],
  paint: () => void,
  background?: string,
) {
  context.save();
  context.scale(layer.devicePixelRatio, layer.devicePixelRatio);
  context.clearRect(0, 0, layer.width, layer.height);

  if (background !== undefined) {
    context.fillStyle = background;
    context.fillRect(0, 0, layer.width, layer.height);
  }

  context.textBaseline = "alphabetic";
  context.translate(0, -layer.paintTop);
  paint();
  context.restore();
}

// Per-line foreground sub-pipeline. Intentionally short and linear — each call
// is a single visual concern, ordered by z-stack.
function paintContentLine(
  context: CanvasRenderingContext2D,
  lineFrame: DocumentFrameLine,
  environment: DocumentFrameEnvironment,
) {
  context.font = lineFrame.layoutLine.font;

  for (const paintLineForeground of lineForegroundPainters) {
    paintLineForeground(lineFrame, environment);
  }
}

type DocumentFrameEnvironment = EffectEnvironment & {
  clocks: DocumentFrame["clocks"];
  paintEffect: PaintEffect;
  resources: DocumentFrame["resources"];
};

type LineForegroundPainter = (
  lineFrame: DocumentFrameLine,
  environment: DocumentFrameEnvironment,
) => void;

const lineForegroundPainters: LineForegroundPainter[] = [
  // Decoration backgrounds below glyphs.
  (lineFrame, environment) => {
    if (lineFrame.textDecorations) {
      paintTextDecorationBackgrounds(
        environment.context,
        lineFrame,
        lineFrame.textDecorations,
        environment.clocks,
      );
    }
  },
  // Selection highlight.
  (lineFrame, environment) => {
    paintSelectionHighlight(environment.context, lineFrame, environment.theme);
  },
  // Comment highlights.
  (lineFrame, environment) => {
    paintCommentHighlights(environment.context, lineFrame, environment.clocks.ambientTime);
  },
  // List marker.
  (lineFrame, environment) => {
    paintListMarker(lineFrame, environment);
  },
  // Text and replacement segments.
  (lineFrame, environment) => {
    paintLineText(environment.context, lineFrame, {
      clocks: environment.clocks,
      resources: environment.resources,
      theme: environment.theme,
    });
  },
  // Decoration overlays above glyphs.
  (lineFrame, environment) => {
    if (lineFrame.textDecorations) {
      paintTextDecorationOverlays(
        environment.context,
        lineFrame,
        lineFrame.textDecorations,
        environment.clocks,
      );
    }
  },
  // Insert highlights.
  (lineFrame, environment) => {
    paintTextHighlights(lineFrame, lineFrame.textHighlights, environment);
  },
  // Delete fades.
  (lineFrame, environment) => {
    paintTextFades(lineFrame, lineFrame.textFades, environment);
  },
  // Text pulses.
  (lineFrame, environment) => {
    paintTextPulses(lineFrame, lineFrame.textPulses, environment);
  },
];
