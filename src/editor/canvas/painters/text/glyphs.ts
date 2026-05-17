// Owns the low-level primitives every text painter draws through. Text runs,
// decorations, and effects all paint into glyph space; they share three jobs:
//   - converting line-relative offsets into absolute x coordinates
//     (`resolveLineSegmentBounds`)
//   - drawing a colored or rounded background behind glyph rows
//     (`paintTextBackground`)
//   - re-drawing text glyphs at a new color clipped to a sub-range, with
//     optional glyph erase first (`paintClippedTextOverlay`)
// Keeping these here means a new text effect (squiggles, etc.) has a single
// place to reach for instead of re-deriving each primitive.

import { measureLineOffsetLeft, type DocumentLayout } from "../../../layout";
import { resolveCenteredTextBaseline, resolveFontMetrics } from "../../../text/measure";

export const textDecorationMinimumWidth = 2;
export const textDecorationThickness = 1.25;

export const editableTextBackgroundGeometry = {
  bottomPadding: 1,
  cornerRadius: 0,
  horizontalPadding: 1,
  topPadding: 2,
  verticalNudge: -1,
} as const;

export type TextBackgroundGeometry = {
  bottomPadding: number;
  cornerRadius: number;
  horizontalPadding: number;
  topPadding: number;
  verticalNudge: number;
};

export function resolveLineSegmentBounds(
  line: DocumentLayout["lines"][number],
  textLeft: number,
  startOffset: number,
  endOffset: number,
) {
  return {
    left: textLeft + (measureLineOffsetLeft(line, startOffset - line.start) - line.left),
    right: textLeft + (measureLineOffsetLeft(line, endOffset - line.start) - line.left),
  };
}

export function resolveStrikethroughTop(textBaseline: number, lineHeight: number, font: string) {
  const { ascent } = resolveFontMetrics(font);
  const lineTop = textBaseline - resolveCenteredTextBaseline(lineHeight, font);

  return Math.max(lineTop + 2, textBaseline - Math.round(ascent * 0.32));
}

export function resolveUnderlineTop(textBaseline: number, lineHeight: number, font: string) {
  const { descent } = resolveFontMetrics(font);
  const descentInset = Math.max(1, Math.round(Math.max(2, descent) * 0.35));
  const glyphBottom = textBaseline + descent - descentInset;
  const lineTop = textBaseline - resolveCenteredTextBaseline(lineHeight, font);

  return Math.min(lineTop + lineHeight - 4, glyphBottom);
}

export function paintTextBackground(
  context: CanvasRenderingContext2D,
  left: number,
  right: number,
  textBaseline: number,
  color: string,
  geometry: TextBackgroundGeometry,
) {
  const backgroundBounds = resolveTextBackgroundBounds(
    context,
    left,
    right,
    textBaseline,
    geometry,
  );

  context.fillStyle = color;
  if (geometry.cornerRadius <= 0) {
    context.fillRect(
      backgroundBounds.left,
      backgroundBounds.top,
      backgroundBounds.width,
      backgroundBounds.height,
    );
    return;
  }

  paintRoundedRect(
    context,
    backgroundBounds.left,
    backgroundBounds.top,
    backgroundBounds.width,
    backgroundBounds.height,
    geometry.cornerRadius,
  );
}

// Redraws `text` at `(textLeft, textBaseline)` clipped to the rectangle
// `(left, top, width, height)`. With `eraseExistingGlyphs`, the first pass
// uses `destination-out` to subtract the existing glyphs from the canvas
// before re-filling at the new color — so the new color replaces (rather
// than blends with) any glyphs already painted underneath.
export function paintClippedTextOverlay(
  context: CanvasRenderingContext2D,
  {
    alpha = 1,
    color,
    eraseExistingGlyphs = false,
    height,
    left,
    text,
    textBaseline,
    textLeft,
    top,
    width,
  }: {
    alpha?: number;
    color: string;
    eraseExistingGlyphs?: boolean;
    height: number;
    left: number;
    text: string;
    textBaseline: number;
    textLeft: number;
    top: number;
    width: number;
  },
) {
  if (width <= 0 || alpha <= 0) {
    return;
  }

  context.save();
  context.beginPath();
  context.rect(left, top, width, height);
  context.clip();

  if (eraseExistingGlyphs) {
    context.globalCompositeOperation = "destination-out";
    context.fillText(text, textLeft, textBaseline);
  }

  context.globalCompositeOperation = "source-over";
  context.globalAlpha *= alpha;
  context.fillStyle = color;
  context.fillText(text, textLeft, textBaseline);
  context.restore();
}

function paintRoundedRect(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
) {
  if (width <= 0 || height <= 0) {
    return;
  }

  context.beginPath();
  context.roundRect(left, top, width, height, Math.min(radius, width / 2, height / 2));
  context.fill();
}

function resolveTextBackgroundBounds(
  context: CanvasRenderingContext2D,
  left: number,
  right: number,
  textBaseline: number,
  geometry: TextBackgroundGeometry,
) {
  const fontMetrics = resolveFontMetrics(context.font);
  const paddedLeft = left - geometry.horizontalPadding;
  const paddedRight = right + geometry.horizontalPadding;

  return {
    height: fontMetrics.ascent + fontMetrics.descent + geometry.topPadding + geometry.bottomPadding,
    left: paddedLeft,
    top: textBaseline - fontMetrics.ascent - geometry.topPadding + geometry.verticalNudge,
    width: Math.max(0, paddedRight - paddedLeft),
  };
}
