// Owns transient text animations: insert highlights (a flash that fades over
// freshly typed text), text fades (ghost text for deletions), and text
// pulses (a radial ping at a punctuation insertion point). Each effect
// reads its descriptor list from the orchestrator, filters to the current
// line, and paints its overlay. All three sit on top of the settled text
// runs so they paint last in the foreground sub-pipeline.

import { measureLineOffsetLeft, type DocumentLayout } from "@/editor/layout";
import { findInlinesInSpan, regionInlines, type RegionEntry } from "@/editor/state";
import { isReferenceInlineNode } from "@/document";
import type { ResolvedEditorTheme } from "@/types";
import { resolveInlineTextStyle } from "@/editor/text/fonts";
import { splitGraphemes } from "@/editor/text/graphemes";
import { resolveFontMetrics } from "@/editor/text/measure";
import { collectRangeBoundaries, findRangeAtSegment } from "@/editor/text/ranges";
import {
  resolveTextFadeColor,
  resolveTextPulseColor,
  type ActiveTextFade,
  type ActiveTextHighlight,
  type ActiveTextPulse,
} from "../../animations";
import { paintClippedTextOverlay, resolveLineSegmentBounds } from "./glyphs";

const textPulseBaseRadius = 4;
const textPulseRadiusGrowth = 4;
const textPulseStrokeWidth = 1.5;
const textHighlightMinimumVisibleAlpha = 0.02;

export function paintTextHighlights(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: RegionEntry | null,
  textLeft: number,
  textBaseline: number,
  textHighlights: ActiveTextHighlight[],
  theme: ResolvedEditorTheme,
) {
  if (!container || textHighlights.length === 0) {
    return;
  }

  const visibleInlines = findInlinesInSpan(regionInlines(container), line.start, line.end);

  for (const inline of visibleInlines) {
    if (isReferenceInlineNode(inline.node)) {
      continue;
    }

    const start = Math.max(line.start, inline.start);
    const end = Math.min(line.end, inline.end);
    const segmentText = container.text.slice(start, end);

    if (segmentText.length === 0) {
      continue;
    }

    const highlightBoundaries = collectRangeBoundaries(start, end, textHighlights).filter(
      (offset) => isTextGraphemeBoundary(container.text, start, end, offset),
    );

    if (highlightBoundaries.length <= 2) {
      const activeHighlight = findRangeAtSegment(textHighlights, start, end);

      if (!activeHighlight) {
        continue;
      }
    }

    const { left: segmentLeft } = resolveLineSegmentBounds(line, textLeft, start, end);
    const inlineStyle = resolveInlineTextStyle(
      line.font,
      inline.node.type === "text" ? inline.node.marks : [],
      inline.node.type === "code",
    );
    context.font = inlineStyle.font;
    const segmentBaseline = textBaseline + inlineStyle.baselineShift;

    for (let index = 0; index < highlightBoundaries.length - 1; index += 1) {
      const highlightStart = highlightBoundaries[index]!;
      const highlightEnd = highlightBoundaries[index + 1]!;
      const activeHighlight = findRangeAtSegment(textHighlights, highlightStart, highlightEnd);

      if (!activeHighlight || highlightEnd <= highlightStart) {
        continue;
      }

      const alpha = 1 - activeHighlight.progress;

      // Near-transparent overlays are visually indistinguishable from settled
      // text, so skip the extra clipped full-run redraw at the fade tail.
      if (alpha <= textHighlightMinimumVisibleAlpha) {
        continue;
      }

      const { left: highlightLeft, right: highlightRight } = resolveLineSegmentBounds(
        line,
        textLeft,
        highlightStart,
        highlightEnd,
      );

      paintClippedTextOverlay(context, {
        alpha,
        color: theme.insertHighlightText,
        height: line.height,
        left: highlightLeft,
        text: segmentText,
        textBaseline: segmentBaseline,
        textLeft: segmentLeft,
        top: line.top,
        width: Math.max(0, highlightRight - highlightLeft),
      });
    }
  }
}

export function paintTextFades(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: RegionEntry | null,
  textLeft: number,
  textBaseline: number,
  textFades: ActiveTextFade[],
  baseColor: string,
) {
  if (!container || textFades.length === 0) {
    return;
  }

  for (const fade of textFades) {
    if (fade.startOffset < line.start || fade.startOffset > line.end) {
      continue;
    }

    const ghostLeft =
      textLeft + (measureLineOffsetLeft(line, fade.startOffset - line.start) - line.left);

    context.fillStyle = resolveTextFadeColor(baseColor, fade);
    context.fillText(fade.text, ghostLeft, textBaseline);
  }
}

export function paintTextPulses(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: RegionEntry | null,
  textLeft: number,
  textBaseline: number,
  textPulses: ActiveTextPulse[],
  theme: ResolvedEditorTheme,
) {
  if (!container || textPulses.length === 0) {
    return;
  }

  for (const pulse of textPulses) {
    if (pulse.offset < line.start || pulse.offset >= line.end) {
      continue;
    }

    const { left, right } = resolveLineSegmentBounds(
      line,
      textLeft,
      pulse.offset,
      pulse.offset + 1,
    );
    const radius = Math.max(
      textPulseBaseRadius,
      (right - left) / 2 + textPulseBaseRadius + textPulseRadiusGrowth * pulse.progress,
    );
    const { ascent, descent } = resolveFontMetrics(line.font);
    const glyphCenterY = textBaseline - Math.max(1, ascent * 0.42) + Math.max(0.5, descent * 0.15);

    context.strokeStyle = resolveTextPulseColor(pulse, theme);
    context.lineWidth = textPulseStrokeWidth;
    context.beginPath();
    context.arc((left + right) / 2, glyphCenterY, radius, 0, Math.PI * 2);
    context.stroke();
  }
}

function isTextGraphemeBoundary(
  text: string,
  startOffset: number,
  endOffset: number,
  offset: number,
) {
  if (offset <= startOffset || offset >= endOffset) {
    return true;
  }

  let cursor = startOffset;

  for (const grapheme of splitGraphemes(text.slice(startOffset, endOffset))) {
    cursor += grapheme.length;
    if (cursor === offset) {
      return true;
    }
    if (cursor > offset) {
      return false;
    }
  }

  return false;
}
