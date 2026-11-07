// Renderer entrypoint. The component host creates immutable frame values;
// this module translates those frames into content and overlay canvas pixels.

import {
  paintActiveBlockChangedEffect,
  paintBlockBackground,
  paintCodeBlockSurface,
} from "./painters/blocks/backgrounds";
import { paintBlockquoteRules, paintRules } from "./painters/blocks/rules";
import { paintCaretOverlay } from "./painters/caret";
import { paintCommentHighlights } from "./painters/comments";
import { paintListMarker } from "./painters/list";
import { paintMetadataBackgrounds, paintMetadataForeground } from "./painters/metadata";
import { paintSelectionHighlight } from "./painters/selection";
import { paintGridCellChrome } from "./painters/table";
import { paintHighlight } from "./painters/highlights";
import {
  paintTextDecorationBackgrounds,
  paintTextDecorationOverlays,
} from "./painters/text/decorations";
import { paintTextFades, paintTextHighlights, paintTextPulses } from "./painters/text/effects";
import { paintLineText } from "./painters/text/inlines";
import {
  createDocumentFrame,
  createOverlayFrame,
  type DocumentFrame,
  type DocumentFrameLine,
  type OverlayFrame,
} from "./frame";
import { createPaintEffect, type EffectEnvironment, type PaintEffect } from "./effects";

export { createDocumentFrame, createOverlayFrame };
export type {
  ActiveBlockChangedEffectContext,
  DocumentChangeEffect,
  DocumintEffectHandler,
  DocumintEffects,
  DocumintListMarkerPaintFrame,
  ListItemInsertedEffectContext,
  RendererEffect,
  RendererEffectInput,
  TextDeletedEffectContext,
  TextInsertedEffectContext,
} from "./effects";
export type { CodeTokenKind, EditorTheme, ResolvedEditorTheme } from "./theme";
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
  paintMetadataBackgroundPass,
  paintBlockTintPass,
  paintContainerBackgroundPass,
  paintInertBlockChromePass,
  paintTableCellHighlightPass,
  paintLineForegroundPass,
  paintRulePass,
];

function paintMetadataBackgroundPass(context: CanvasRenderingContext2D, frame: DocumentFrame) {
  paintMetadataBackgrounds(context, frame.metadata, frame.theme);
}

// Active and change tints paint under container surfaces so code keeps its
// own contrast. Over a code block they show in the margins beside the surface.
function paintBlockTintPass(context: CanvasRenderingContext2D, frame: DocumentFrame) {
  const { codeBlockSurfaces } = frame.chrome;

  for (const lineFrame of frame.lines) {
    paintBlockBackground(context, lineFrame.activeBlockBackground);
  }

  for (const surface of codeBlockSurfaces) {
    paintBlockBackground(context, surface.activeBlockBackground);
  }

  if (frame.hasDocumentChangeHighlights) {
    for (const lineFrame of frame.lines) {
      paintBlockBackground(context, lineFrame.documentChangeBackground);
    }

    for (const surface of codeBlockSurfaces) {
      paintBlockBackground(context, surface.documentChangeBackground);
    }
  }
}

function paintContainerBackgroundPass(context: CanvasRenderingContext2D, frame: DocumentFrame) {
  for (const surface of frame.chrome.codeBlockSurfaces) {
    paintCodeBlockSurface(context, surface.rect, frame.theme);
  }

  for (const cell of frame.chrome.tableCells) {
    paintGridCellChrome(context, cell.rect, cell.isHeaderRow, frame.theme);
  }
}

function paintInertBlockChromePass(context: CanvasRenderingContext2D, frame: DocumentFrame) {
  paintRules(context, frame.theme.dividerRule, frame.chrome.dividerRules);
}

function paintTableCellHighlightPass(context: CanvasRenderingContext2D, frame: DocumentFrame) {
  for (const tableCellChange of frame.tableCellDocumentChanges) {
    paintHighlight(context, tableCellChange, {
      borderColor: frame.theme.tableBorder,
      fill: tableCellChange.color,
      opacity: tableCellChange.opacity,
    });
  }

  if (frame.chrome.activeTableCellGeometry) {
    paintHighlight(context, frame.chrome.activeTableCellGeometry, {
      borderColor: frame.theme.tableBorder,
      fill: frame.theme.activeBlockBackground,
    });
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
    ambientTime: frame.ambientTime,
    paintEffect: createPaintEffect(baseEnvironment, frame.customEffects),
    resources: frame.resources,
  };

  paintActiveBlockChangedEffect(frame.activeBlockChangedEffect, environment);
  paintMetadataForeground(context, frame.metadata, frame.theme);

  for (const lineFrame of frame.lines) {
    paintContentLine(context, lineFrame, environment);
  }
}

function paintRulePass(context: CanvasRenderingContext2D, frame: DocumentFrame) {
  paintRules(context, frame.theme.headingRule, frame.chrome.headingRules.values());
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
  ambientTime: number;
  paintEffect: PaintEffect;
  resources: DocumentFrame["resources"];
};

type LineForegroundPainter = (
  lineFrame: DocumentFrameLine,
  environment: DocumentFrameEnvironment,
) => void;

const lineForegroundPainters: LineForegroundPainter[] = [
  // Decoration backgrounds below glyphs.
  paintTextDecorationBackgrounds,
  paintSelectionHighlight,
  paintCommentHighlights,
  paintListMarker,
  // Text and replacement segments.
  paintLineText,
  // Decoration overlays above glyphs.
  paintTextDecorationOverlays,
  // Insert highlights, delete fades, and text pulses.
  paintTextHighlights,
  paintTextFades,
  paintTextPulses,
];
