// Owns paint for the host-supplied text decoration index (spell-check
// hints, search matches, AI suggestions — anything that decorates a region
// span without owning a marked-up document range). Decorations paint in two
// phases: backgrounds run before the text runs so glyph color stays on top;
// color overlays run after the text runs so they replace base glyph fills.
// The orchestrator drives the two phases through two separate entry points
// (`paintTextDecorationBackgrounds`, `paintTextDecorationOverlays`) so the
// phase isn't a runtime branch.

import type { DocumentLayout } from "@/editor/layout";
import {
  findInlinesInRange,
  regionInlines,
  type IndexedInline,
  type EditableRegion,
} from "@/editor/state";
import type { TextDecoration } from "@/editor/text/decorations";
import { resolveInlineTextStyle } from "@/editor/text/fonts";
import { isReferenceInlineNode } from "@/document";
import {
  collectRangeBoundaries,
  filterRangesOverlappingSegment,
  findRangeAtSegment,
} from "@/editor/text/ranges";
import { blendCanvasColors, resolveOptionalCanvasColor } from "../../animations/colors";
import {
  resolveRestingPulseAlpha,
  resolveRestingPulseProgress,
  restingPulseMinimumAlpha,
} from "../../animations/pulse";
import {
  editableTextBackgroundGeometry,
  paintClippedTextOverlay,
  paintTextBackground,
  resolveLineSegmentBounds,
} from "./glyphs";

const decorationPulseTextMaximumBaseBlend = 0.72;
const minimumDecorationTextContrast = 4.5;
const decorationTextContrastStep = 0.05;

export function paintTextDecorationBackgrounds(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: EditableRegion | null,
  textLeft: number,
  textBaseline: number,
  textDecorations: readonly TextDecoration[],
  decorationAnimationTime: number,
) {
  forEachDecorationSegment(
    context,
    line,
    container,
    textLeft,
    textBaseline,
    textDecorations,
    (segment, decoration) => {
      if (!decoration.backgroundColor) {
        return;
      }

      paintDecorationBackground(context, {
        color: decoration.backgroundColor,
        decorationAnimationTime,
        left: segment.left,
        pulse: decoration.pulse === true,
        right: segment.right,
        textBaseline: segment.textBaseline,
      });
    },
  );
}

export function paintTextDecorationOverlays(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: EditableRegion | null,
  textLeft: number,
  textBaseline: number,
  textDecorations: readonly TextDecoration[],
  decorationAnimationTime: number,
  baseTextColor: string,
) {
  forEachDecorationSegment(
    context,
    line,
    container,
    textLeft,
    textBaseline,
    textDecorations,
    (segment, decoration) => {
      if (!decoration.color && !decoration.backgroundColor) {
        return;
      }

      paintClippedTextOverlay(context, {
        color: resolveDecorationTextColor(decoration, decorationAnimationTime, baseTextColor),
        eraseExistingGlyphs: true,
        height: line.height,
        left: segment.left,
        text: segment.segmentText,
        textBaseline: segment.textBaseline,
        textLeft: segment.segmentLeft,
        top: line.top,
        width: Math.max(0, segment.right - segment.left),
      });
    },
  );
}

// Shared walk over the visible inlines and their overlapping decoration
// boundaries. The two phases differ only in what they do with each segment;
// inline iteration, boundary collection, and segment geometry are identical.
function forEachDecorationSegment(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: EditableRegion | null,
  textLeft: number,
  textBaseline: number,
  textDecorations: readonly TextDecoration[],
  paintSegment: (
    segment: {
      left: number;
      right: number;
      segmentLeft: number;
      segmentText: string;
      textBaseline: number;
    },
    decoration: TextDecoration,
  ) => void,
) {
  if (!container || textDecorations.length === 0) {
    return;
  }

  const lineDecorations = filterRangesOverlappingSegment(textDecorations, line.start, line.end);

  if (lineDecorations.length === 0) {
    return;
  }

  const visibleInlines = findInlinesInRange(regionInlines(container), line.start, line.end);

  if (visibleInlines.length === 0) {
    const segmentText = container.text.slice(line.start, line.end);
    if (segmentText.length === 0) {
      return;
    }

    const { left: segmentLeft } = resolveLineSegmentBounds(line, textLeft, line.start, line.end);
    context.font = line.font;
    paintDecorationSegments({
      line,
      lineDecorations,
      paintSegment,
      segmentLeft,
      segmentText,
      start: line.start,
      end: line.end,
      textLeft,
      textBaseline,
    });
    return;
  }

  for (const inline of visibleInlines) {
    if (!canPaintTextDecoration(inline)) {
      continue;
    }

    const start = Math.max(line.start, inline.start);
    const end = Math.min(line.end, inline.end);
    const segmentText = container.text.slice(start, end);

    if (segmentText.length === 0) {
      continue;
    }

    const segmentDecorations = filterRangesOverlappingSegment(lineDecorations, start, end);

    if (segmentDecorations.length === 0) {
      continue;
    }

    const { left: segmentLeft } = resolveLineSegmentBounds(line, textLeft, start, end);
    const inlineStyle = resolveInlineTextStyle(
      line.font,
      inline.node.type === "text" ? inline.node.marks : [],
    );
    context.font = inlineStyle.font;
    const segmentBaseline = textBaseline + inlineStyle.baselineShift;

    paintDecorationSegments({
      line,
      lineDecorations: segmentDecorations,
      paintSegment,
      segmentLeft,
      segmentText,
      start,
      end,
      textLeft,
      textBaseline: segmentBaseline,
    });
  }
}

function canPaintTextDecoration(inline: IndexedInline) {
  return !isReferenceInlineNode(inline.node);
}

function paintDecorationSegments({
  line,
  lineDecorations,
  paintSegment,
  segmentLeft,
  segmentText,
  start,
  end,
  textLeft,
  textBaseline,
}: {
  line: DocumentLayout["lines"][number];
  lineDecorations: readonly TextDecoration[];
  paintSegment: (
    segment: {
      left: number;
      right: number;
      segmentLeft: number;
      segmentText: string;
      textBaseline: number;
    },
    decoration: TextDecoration,
  ) => void;
  segmentLeft: number;
  segmentText: string;
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

    paintSegment({ left, right, segmentLeft, segmentText, textBaseline }, textDecoration);
  }
}

function paintDecorationBackground(
  context: CanvasRenderingContext2D,
  {
    color,
    decorationAnimationTime,
    left,
    pulse,
    right,
    textBaseline,
  }: {
    color: string;
    decorationAnimationTime: number;
    left: number;
    pulse: boolean;
    right: number;
    textBaseline: number;
  },
) {
  if (!pulse) {
    paintTextBackground(context, left, right, textBaseline, color, editableTextBackgroundGeometry);
    return;
  }

  context.save();
  context.globalAlpha *= resolveRestingPulseAlpha(
    decorationAnimationTime,
    restingPulseMinimumAlpha,
  );
  paintTextBackground(context, left, right, textBaseline, color, editableTextBackgroundGeometry);
  context.restore();
}

function resolveDecorationTextColor(
  decoration: TextDecoration,
  decorationAnimationTime: number,
  baseTextColor: string,
) {
  const restingColor = resolveContrastingDecorationTextColor(
    decoration.color ?? baseTextColor,
    decoration.backgroundColor,
  );

  if (!decoration.pulse || !decoration.backgroundColor) {
    return restingColor;
  }

  const pulseProgress = resolveRestingPulseProgress(decorationAnimationTime);
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

  const black: [number, number, number, number] = [0, 0, 0, text[3]];
  const white: [number, number, number, number] = [255, 255, 255, text[3]];
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

function contrastRatio(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
) {
  const aLuminance = relativeLuminance(a);
  const bLuminance = relativeLuminance(b);
  const lighter = Math.max(aLuminance, bLuminance);
  const darker = Math.min(aLuminance, bLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: readonly [number, number, number, number]) {
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

function mixCanvasColor(
  from: readonly [number, number, number, number],
  to: readonly [number, number, number, number],
  progress: number,
): [number, number, number, number] {
  return [
    from[0] + (to[0] - from[0]) * progress,
    from[1] + (to[1] - from[1]) * progress,
    from[2] + (to[2] - from[2]) * progress,
    from[3],
  ];
}

function formatCanvasColor(color: readonly [number, number, number, number]) {
  return `rgba(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])}, ${color[3]})`;
}
