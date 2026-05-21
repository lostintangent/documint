// Owns paint for the host-supplied text decoration index (spell-check
// hints, search matches, AI suggestions — anything that decorates a region
// span without owning a marked-up document range). Decorations paint in two
// phases: backgrounds run before the text runs so glyph color stays on top;
// color overlays run after the text runs so they replace base glyph fills.
// The orchestrator drives the two phases through two separate entry points
// (`paintTextDecorationBackgrounds`, `paintTextDecorationOverlays`) so the
// phase isn't a runtime branch.

import type { DocumentLayout } from "@/editor/layout";
import { findInlinesInSpan, type EditorInline, type EditorRegion } from "@/editor/state";
import type { TextDecoration } from "@/editor/text/decorations";
import { resolveMarkedTextFont } from "@/editor/text/fonts";
import {
  collectRangeBoundaries,
  filterRangesOverlappingSegment,
  findRangeAtSegment,
} from "@/editor/text/ranges";
import { blendCanvasColors } from "../../animations/colors";
import { resolveRestingPulseAlpha, resolveRestingPulseProgress, restingPulseMinimumAlpha } from "../../animations/pulse";
import {
  editableTextBackgroundGeometry,
  paintClippedTextOverlay,
  paintTextBackground,
  resolveLineSegmentBounds,
} from "./glyphs";

const decorationPulseTextMaximumBaseBlend = 0.72;

export function paintTextDecorationBackgrounds(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: EditorRegion | null,
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
        textBaseline,
      });
    },
  );
}

export function paintTextDecorationOverlays(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: EditorRegion | null,
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
    textDecorations,
    (segment, decoration) => {
      if (!decoration.color) {
        return;
      }

      paintClippedTextOverlay(context, {
        color: resolveDecorationTextColor(decoration, decorationAnimationTime, baseTextColor),
        eraseExistingGlyphs: true,
        height: line.height,
        left: segment.left,
        text: segment.segmentText,
        textBaseline,
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
  container: EditorRegion | null,
  textLeft: number,
  textDecorations: readonly TextDecoration[],
  paintSegment: (
    segment: {
      left: number;
      right: number;
      segmentLeft: number;
      segmentText: string;
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

  const visibleInlines = findInlinesInSpan(container.inlines, line.start, line.end);

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

    const decorationBoundaries = collectRangeBoundaries(start, end, segmentDecorations);

    const { left: segmentLeft } = resolveLineSegmentBounds(line, textLeft, start, end);
    context.font = resolveMarkedTextFont(line.font, inline.marks);

    for (let index = 0; index < decorationBoundaries.length - 1; index += 1) {
      const decorationStart = decorationBoundaries[index]!;
      const decorationEnd = decorationBoundaries[index + 1]!;
      const textDecoration = findRangeAtSegment(
        segmentDecorations,
        decorationStart,
        decorationEnd,
      );

      if (!textDecoration || decorationEnd <= decorationStart) {
        continue;
      }

      const { left, right } = resolveLineSegmentBounds(
        line,
        textLeft,
        decorationStart,
        decorationEnd,
      );

      paintSegment({ left, right, segmentLeft, segmentText }, textDecoration);
    }
  }
}

function canPaintTextDecoration(inline: EditorInline) {
  return (
    inline.kind !== "image" && inline.kind !== "mention" && inline.kind !== "code" && !inline.link
  );
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
  if (!decoration.pulse || !decoration.backgroundColor) {
    return decoration.color ?? baseTextColor;
  }

  const pulseProgress = resolveRestingPulseProgress(decorationAnimationTime);
  const blendProgress = (1 - pulseProgress) * decorationPulseTextMaximumBaseBlend;

  return blendCanvasColors(decoration.color ?? baseTextColor, baseTextColor, blendProgress);
}
