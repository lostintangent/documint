// Owns paint for the host-supplied text decoration index (spell-check
// hints, search matches, AI suggestions — anything that decorates a text
// span without owning a marked-up document range). Decorations paint in two
// phases: backgrounds run before the text runs so glyph color stays on top;
// color overlays run after the text runs so they replace base glyph fills.
// The orchestrator drives the two phases through two separate entry points
// (`paintTextDecorationBackgrounds`, `paintTextDecorationOverlays`) so the
// phase isn't a runtime branch.

import type { DocumentLayout } from "@/editor/layout";
import type { DocumentFrameLine } from "@/renderer/frame";
import { isTextRunSegment } from "@/renderer/frame/line/text-segments";
import { resolveLineSegmentBounds } from "@/renderer/frame/line/text-geometry";
import type { TextDecoration } from "@/editor/text/decorations";
import {
  collectRangeBoundaries,
  filterRangesOverlappingSegment,
  findRangeAtSegment,
} from "@/editor/text/ranges";
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
  clocks: { ambientTime: number };
  context: CanvasRenderingContext2D;
};

export function paintTextDecorationBackgrounds(
  lineFrame: DocumentFrameLine,
  { clocks, context }: DecorationPaintEnvironment,
) {
  forEachDecoratedTextSegment(context, lineFrame, (segment, decoration) => {
    if (!decoration.backgroundColor) {
      return;
    }

    paintDecorationBackground(context, {
      color: decoration.backgroundColor,
      decorationTime: clocks.ambientTime,
      left: segment.left,
      pulse: decoration.pulse === true,
      right: segment.right,
      textBaseline: segment.textBaseline,
    });
  });
}

export function paintTextDecorationOverlays(
  lineFrame: DocumentFrameLine,
  { clocks, context }: DecorationPaintEnvironment,
) {
  forEachDecoratedTextSegment(context, lineFrame, (segment, decoration) => {
    if (!decoration.color && !decoration.backgroundColor) {
      return;
    }

    paintClippedTextOverlay(context, {
      color: resolveDecorationTextColor(decoration, clocks.ambientTime, segment.textColor),
      eraseExistingGlyphs: true,
      height: lineFrame.layoutLine.height,
      left: segment.left,
      text: segment.text,
      textBaseline: segment.textBaseline,
      textLeft: segment.textLeft,
      top: lineFrame.layoutLine.top,
      width: Math.max(0, segment.right - segment.left),
    });
  });
}

function forEachDecoratedTextSegment(
  context: CanvasRenderingContext2D,
  lineFrame: DocumentFrameLine,
  paintSegment: (segment: DecorationSegment, decoration: TextDecoration) => void,
) {
  const { textDecorations } = lineFrame;

  if (!textDecorations) {
    return;
  }

  const lineDecorations = filterRangesOverlappingSegment(
    textDecorations,
    lineFrame.layoutLine.start,
    lineFrame.layoutLine.end,
  );

  if (lineDecorations.length === 0) {
    return;
  }

  for (const textSegment of lineFrame.segments) {
    if (!isTextRunSegment(textSegment)) {
      continue;
    }

    const segmentDecorations = filterRangesOverlappingSegment(
      lineDecorations,
      textSegment.start,
      textSegment.end,
    );

    if (segmentDecorations.length === 0) {
      continue;
    }

    context.font = textSegment.font;
    paintDecorationSegments({
      line: lineFrame.layoutLine,
      lineDecorations: segmentDecorations,
      paintSegment,
      segmentLeft: textSegment.left,
      segmentText: textSegment.text,
      start: textSegment.start,
      end: textSegment.end,
      textColor: textSegment.color,
      textLeft: lineFrame.textLeft,
      textBaseline: textSegment.baseline,
    });
  }
}

type DecorationSegment = {
  left: number;
  right: number;
  text: string;
  textBaseline: number;
  textColor: string;
  textLeft: number;
};

function paintDecorationSegments({
  line,
  lineDecorations,
  paintSegment,
  segmentLeft,
  segmentText,
  textColor,
  start,
  end,
  textLeft,
  textBaseline,
}: {
  line: DocumentLayout["lines"][number];
  lineDecorations: readonly TextDecoration[];
  paintSegment: (segment: DecorationSegment, decoration: TextDecoration) => void;
  segmentLeft: number;
  segmentText: string;
  textColor: string;
  start: number;
  end: number;
  textLeft: number;
  textBaseline: number;
}) {
  const decorationBoundaries = collectRangeBoundaries(start, end, lineDecorations);

  for (let index = 0; index < decorationBoundaries.length - 1; index += 1) {
    const decorationStart = decorationBoundaries[index]!;
    const decorationEnd = decorationBoundaries[index + 1]!;
    const textDecoration = findRangeAtSegment(lineDecorations, decorationStart, decorationEnd);

    if (!textDecoration || decorationEnd <= decorationStart) {
      continue;
    }

    const { left, right } = resolveLineSegmentBounds(
      line,
      textLeft,
      decorationStart,
      decorationEnd,
    );

    paintSegment(
      {
        left,
        right,
        text: segmentText,
        textBaseline,
        textColor,
        textLeft: segmentLeft,
      },
      textDecoration,
    );
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
