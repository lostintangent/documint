// Owns the low-level primitives every text painter draws through. Text runs,
// decorations, and effects all paint into glyph space; they share two jobs:
//   - drawing a colored background behind glyph rows
//     (`paintTextBackground`)
//   - re-drawing text glyphs at a new color clipped to a sub-range, with
//     optional glyph erase first (`paintClippedTextOverlay`)
// Keeping these here means a new text effect (squiggles, etc.) has a single
// place to reach for instead of re-deriving each primitive.

import { resolveCenteredTextBaseline, resolveFontMetrics } from "@/editor/text/measure";

export const textDecorationMinimumWidth = 2;
export const textDecorationThickness = 1.25;

const textBackgroundBottomPadding = 1;
const textBackgroundHorizontalPadding = 1;
const textBackgroundTopPadding = 2;
const textBackgroundVerticalNudge = -1;

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
) {
  const backgroundBounds = resolveTextBackgroundBounds(context, left, right, textBaseline);

  context.fillStyle = color;
  context.fillRect(
    backgroundBounds.left,
    backgroundBounds.top,
    backgroundBounds.width,
    backgroundBounds.height,
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

function resolveTextBackgroundBounds(
  context: CanvasRenderingContext2D,
  left: number,
  right: number,
  textBaseline: number,
) {
  const fontMetrics = resolveFontMetrics(context.font);
  const paddedLeft = left - textBackgroundHorizontalPadding;
  const paddedRight = right + textBackgroundHorizontalPadding;

  return {
    height:
      fontMetrics.ascent +
      fontMetrics.descent +
      textBackgroundTopPadding +
      textBackgroundBottomPadding,
    left: paddedLeft,
    top: textBaseline - fontMetrics.ascent - textBackgroundTopPadding + textBackgroundVerticalNudge,
    width: Math.max(0, paddedRight - paddedLeft),
  };
}
