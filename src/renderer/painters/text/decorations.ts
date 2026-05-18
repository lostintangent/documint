// Owns paint for the host-supplied text decoration index (spell-check
// hints, search matches, AI suggestions — anything that decorates a region
// span without owning a marked-up document range). Decorations paint in two
// phases: backgrounds run before the text runs so glyph color stays on top;
// color overlays run after the text runs so they replace base glyph fills.
// The orchestrator drives both phases through `paintTextDecorations(phase)`.

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

export function paintTextDecorations(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: EditorRegion | null,
  textLeft: number,
  textBaseline: number,
  textDecorations: readonly TextDecoration[],
  phase: "background" | "overlay",
  decorationAnimationTime: number,
  baseTextColor: string,
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

      const { left: decorationLeft, right: decorationRight } = resolveLineSegmentBounds(
        line,
        textLeft,
        decorationStart,
        decorationEnd,
      );

      paintDecorationSegment(context, {
        baseTextColor,
        decoration: textDecoration,
        decorationAnimationTime,
        height: line.height,
        left: decorationLeft,
        phase,
        right: decorationRight,
        text: segmentText,
        textBaseline,
        textLeft: segmentLeft,
        top: line.top,
      });
    }
  }
}

function canPaintTextDecoration(inline: EditorInline) {
  return (
    inline.kind !== "image" && inline.kind !== "mention" && inline.kind !== "code" && !inline.link
  );
}

function paintDecorationSegment(
  context: CanvasRenderingContext2D,
  {
    baseTextColor,
    decoration,
    decorationAnimationTime,
    height,
    left,
    phase,
    right,
    text,
    textBaseline,
    textLeft,
    top,
  }: {
    baseTextColor: string;
    decoration: TextDecoration;
    decorationAnimationTime: number;
    height: number;
    left: number;
    phase: "background" | "overlay";
    right: number;
    text: string;
    textBaseline: number;
    textLeft: number;
    top: number;
  },
) {
  if (phase === "background") {
    if (!decoration.backgroundColor) {
      return;
    }

    paintDecorationBackground(context, {
      color: decoration.backgroundColor,
      decorationAnimationTime,
      left,
      pulse: decoration.pulse === true,
      right,
      textBaseline,
    });
    return;
  }

  if (!decoration.color) {
    return;
  }

  paintClippedTextOverlay(context, {
    color: resolveDecorationTextColor(decoration, decorationAnimationTime, baseTextColor),
    eraseExistingGlyphs: true,
    height,
    left,
    text,
    textBaseline,
    textLeft,
    top,
    width: Math.max(0, right - left),
  });
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
