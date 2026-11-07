// Owns paint for the host-supplied text decoration index (spell-check
// hints, search matches, AI suggestions — anything that decorates a text
// span without owning a marked-up document range). Decorations paint in two
// phases: backgrounds run before the text runs so glyph color stays on top;
// color overlays run after the text runs so they replace base glyph fills.
// The orchestrator drives the two phases through two separate entry points
// (`paintTextDecorationBackgrounds`, `paintTextDecorationOverlays`) so the
// phase isn't a runtime branch.

import type { DocumentFrameLine } from "@/renderer/frame";
import { isTextRunSegment, type TextRunSegment } from "@/renderer/frame/line/text-segments";
import { resolveLineSegmentBounds } from "@/renderer/frame/line/text-geometry";
import type { TextDecoration } from "@/editor/text/decorations";
import { collectRangeBoundaries, rangeOverlapsSegment } from "@/editor/text/ranges";
import {
  blendCanvasColors,
  formatCanvasColor,
  mixCanvasColor,
  resolveOptionalCanvasColor,
  type CanvasColor,
} from "../../effects/colors";
import { paintAmbientlyPulsing, resolveRestingPulseProgress } from "../../effects/pulse";
import { paintClippedTextOverlay, paintTextBackground } from "./glyphs";

const decorationPulseTextMaximumBaseBlend = 0.72;
const minimumDecorationTextContrast = 4.5;
const decorationTextContrastStep = 0.05;

type DecorationPaintEnvironment = {
  ambientTime: number;
  context: CanvasRenderingContext2D;
};

export function paintTextDecorationBackgrounds(
  lineFrame: DocumentFrameLine,
  { ambientTime, context }: DecorationPaintEnvironment,
) {
  forEachDecoratedTextSegment(context, lineFrame, (textSegment, decoration, left, right) => {
    if (!decoration.backgroundColor) {
      return;
    }

    paintDecorationBackground(context, {
      color: decoration.backgroundColor,
      decorationTime: ambientTime,
      left,
      pulse: decoration.pulse === true,
      right,
      textBaseline: textSegment.baseline,
    });
  });
}

export function paintTextDecorationOverlays(
  lineFrame: DocumentFrameLine,
  { ambientTime, context }: DecorationPaintEnvironment,
) {
  forEachDecoratedTextSegment(context, lineFrame, (textSegment, decoration, left, right) => {
    if (!decoration.color && !decoration.backgroundColor) {
      return;
    }

    paintClippedTextOverlay(context, {
      color: resolveDecorationTextColor(decoration, ambientTime, textSegment.color),
      eraseExistingGlyphs: true,
      height: lineFrame.layoutLine.height,
      left,
      text: textSegment.text,
      textBaseline: textSegment.baseline,
      textLeft: textSegment.left,
      top: lineFrame.layoutLine.top,
      width: Math.max(0, right - left),
    });
  });
}

// Splits each decorated text run at decoration boundaries and visits every
// span with the first decoration covering it.
function forEachDecoratedTextSegment(
  context: CanvasRenderingContext2D,
  lineFrame: DocumentFrameLine,
  paintSpan: (
    textSegment: TextRunSegment,
    decoration: TextDecoration,
    left: number,
    right: number,
  ) => void,
) {
  const { textDecorations } = lineFrame;

  if (!textDecorations) {
    return;
  }

  const lineDecorations = textDecorations.filter((decoration) =>
    rangeOverlapsSegment(decoration, lineFrame.layoutLine.start, lineFrame.layoutLine.end),
  );

  if (lineDecorations.length === 0) {
    return;
  }

  for (const textSegment of lineFrame.segments) {
    if (!isTextRunSegment(textSegment)) {
      continue;
    }

    const segmentDecorations = lineDecorations.filter((decoration) =>
      rangeOverlapsSegment(decoration, textSegment.start, textSegment.end),
    );

    if (segmentDecorations.length === 0) {
      continue;
    }

    context.font = textSegment.font;

    const boundaries = collectRangeBoundaries(
      textSegment.start,
      textSegment.end,
      segmentDecorations,
    );

    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const start = boundaries[index]!;
      const end = boundaries[index + 1]!;
      const decoration = segmentDecorations.find((candidate) =>
        rangeOverlapsSegment(candidate, start, end),
      );

      if (!decoration) {
        continue;
      }

      const { left, right } = resolveLineSegmentBounds(
        lineFrame.layoutLine,
        lineFrame.textLeft,
        start,
        end,
      );

      paintSpan(textSegment, decoration, left, right);
    }
  }
}

function paintDecorationBackground(
  context: CanvasRenderingContext2D,
  {
    color,
    decorationTime,
    left,
    pulse,
    right,
    textBaseline,
  }: {
    color: string;
    decorationTime: number;
    left: number;
    pulse: boolean;
    right: number;
    textBaseline: number;
  },
) {
  if (!pulse) {
    paintTextBackground(context, left, right, textBaseline, color);
    return;
  }

  paintAmbientlyPulsing(context, decorationTime, () => {
    paintTextBackground(context, left, right, textBaseline, color);
  });
}

function resolveDecorationTextColor(
  decoration: TextDecoration,
  decorationTime: number,
  baseTextColor: string,
) {
  const restingColor = resolveContrastingDecorationTextColor(
    decoration.color ?? baseTextColor,
    decoration.backgroundColor,
  );

  if (!decoration.pulse || !decoration.backgroundColor) {
    return restingColor;
  }

  const pulseProgress = resolveRestingPulseProgress(decorationTime);
  const blendProgress = (1 - pulseProgress) * decorationPulseTextMaximumBaseBlend;

  return blendCanvasColors(restingColor, baseTextColor, blendProgress);
}

function resolveContrastingDecorationTextColor(textColor: string, backgroundColor?: string) {
  if (!backgroundColor) {
    return textColor;
  }

  const text = resolveOptionalCanvasColor(textColor);
  const background = resolveOptionalCanvasColor(backgroundColor);

  if (!text || !background) {
    return textColor;
  }

  if (contrastRatio(text, background) >= minimumDecorationTextContrast) {
    return textColor;
  }

  const black: CanvasColor = [0, 0, 0, text[3]];
  const white: CanvasColor = [255, 255, 255, text[3]];
  const blackContrast = contrastRatio(black, background);
  const whiteContrast = contrastRatio(white, background);
  const target = blackContrast >= whiteContrast ? black : white;

  for (
    let progress = decorationTextContrastStep;
    progress <= 1;
    progress += decorationTextContrastStep
  ) {
    const adjusted = mixCanvasColor(text, target, progress);

    if (contrastRatio(adjusted, background) >= minimumDecorationTextContrast) {
      return formatCanvasColor(adjusted);
    }
  }

  return formatCanvasColor(target);
}

function contrastRatio(a: CanvasColor, b: CanvasColor) {
  const aLuminance = relativeLuminance(a);
  const bLuminance = relativeLuminance(b);
  const lighter = Math.max(aLuminance, bLuminance);
  const darker = Math.min(aLuminance, bLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: CanvasColor) {
  const [r, g, b] = color;
  return (
    0.2126 * linearizeRgbChannel(r) +
    0.7152 * linearizeRgbChannel(g) +
    0.0722 * linearizeRgbChannel(b)
  );
}

function linearizeRgbChannel(value: number) {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}
