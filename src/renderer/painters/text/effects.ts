// Owns transient text effects: insert highlights (a flash that fades over
// freshly typed text), text fades (ghost text for deletions), and text
// pulses (a radial ping at a punctuation insertion point). Each effect
// reads its descriptor list from the orchestrator, filters to the current
// line, and paints its overlay. All three sit on top of the settled text
// runs so they paint last in the foreground sub-pipeline.

import { splitGraphemes } from "@/editor/text/graphemes";
import { resolveFontMetrics } from "@/editor/text/measure";
import { collectRangeBoundaries, rangeOverlapsSegment } from "@/editor/text/ranges";
import type { DocumentFrameLine } from "@/renderer/frame";
import { isTextRunSegment } from "@/renderer/frame/line/text-segments";
import { resolveLineSegmentBounds } from "@/renderer/frame/line/text-geometry";
import type { EffectEnvironment, PaintEffect, TextDeletedEffectContext } from "../../effects";
import { fadeCanvasColor } from "../../effects/colors";
import { paintClippedTextOverlay } from "./glyphs";

const textPulseBaseRadius = 4;
const textPulseRadiusGrowth = 4;
const textPulseStrokeWidth = 1.5;
const textHighlightMinimumVisibleAlpha = 0.02;

export function paintTextHighlights(
  lineFrame: DocumentFrameLine,
  environment: EffectEnvironment & { paintEffect: PaintEffect },
) {
  const { context, paintEffect, theme } = environment;
  const { layoutLine, textHighlights } = lineFrame;

  if (textHighlights.length === 0) {
    return;
  }

  for (const textSegment of lineFrame.segments) {
    if (!isTextRunSegment(textSegment) || textSegment.text.length === 0) {
      continue;
    }

    const highlightBoundaries = collectRangeBoundaries(
      textSegment.start,
      textSegment.end,
      textHighlights,
    ).filter((offset) => isTextGraphemeBoundary(textSegment.text, textSegment.start, offset));

    if (
      highlightBoundaries.length <= 2 &&
      !textHighlights.some((highlight) =>
        rangeOverlapsSegment(highlight, textSegment.start, textSegment.end),
      )
    ) {
      continue;
    }

    context.font = textSegment.font;

    for (let index = 0; index < highlightBoundaries.length - 1; index += 1) {
      const highlightStart = highlightBoundaries[index]!;
      const highlightEnd = highlightBoundaries[index + 1]!;
      const activeHighlight = textHighlights.find((highlight) =>
        rangeOverlapsSegment(highlight, highlightStart, highlightEnd),
      );

      if (!activeHighlight) {
        continue;
      }

      const alpha = 1 - activeHighlight.progress;

      // Near-transparent overlays are visually indistinguishable from settled
      // text, so skip the extra clipped full-run redraw at the fade tail.
      if (alpha <= textHighlightMinimumVisibleAlpha) {
        continue;
      }

      const { left: highlightLeft, right: highlightRight } = resolveLineSegmentBounds(
        layoutLine,
        lineFrame.textLeft,
        highlightStart,
        highlightEnd,
      );
      const width = Math.max(0, highlightRight - highlightLeft);

      paintEffect(
        activeHighlight,
        {
          anchor: {
            x: highlightLeft,
            y: textSegment.baseline,
          },
          contentKind: activeHighlight.contentKind,
          progress: activeHighlight.progress,
          text: activeHighlight.text,
        },
        ({ context }) => {
          paintClippedTextOverlay(context, {
            alpha,
            color: theme.insertHighlightText,
            height: layoutLine.height,
            left: highlightLeft,
            text: textSegment.text,
            textBaseline: textSegment.baseline,
            textLeft: textSegment.left,
            top: layoutLine.top,
            width,
          });
        },
      );
    }
  }
}

export function paintTextFades(
  lineFrame: DocumentFrameLine,
  environment: EffectEnvironment & { paintEffect: PaintEffect },
) {
  const { paintEffect } = environment;
  const { layoutLine } = lineFrame;

  for (const fade of lineFrame.textFades) {
    // A deletion at the line end still ghosts after the last glyph.
    if (fade.startOffset < layoutLine.start || fade.startOffset > layoutLine.end) {
      continue;
    }

    const { left: ghostLeft } = resolveLineSegmentBounds(
      layoutLine,
      lineFrame.textLeft,
      fade.startOffset,
      fade.startOffset,
    );

    const color = fadeCanvasColor(lineFrame.defaultTextColor, fade.progress);

    paintEffect(
      fade,
      {
        color,
        contentKind: fade.contentKind,
        font: layoutLine.font,
        left: ghostLeft,
        progress: fade.progress,
        text: fade.text,
        textBaseline: lineFrame.textBaseline,
      },
      paintDefaultTextDeleted,
    );
  }
}

function paintDefaultTextDeleted({
  color,
  context,
  left,
  text,
  textBaseline,
}: TextDeletedEffectContext) {
  context.fillStyle = color;
  context.fillText(text, left, textBaseline);
}

export function paintTextPulses(
  lineFrame: DocumentFrameLine,
  environment: EffectEnvironment & { paintEffect: PaintEffect },
) {
  const { paintEffect, theme } = environment;
  const { layoutLine } = lineFrame;

  for (const pulse of lineFrame.textPulses) {
    if (pulse.startOffset < layoutLine.start || pulse.startOffset >= layoutLine.end) {
      continue;
    }

    const { left, right } = resolveLineSegmentBounds(
      layoutLine,
      lineFrame.textLeft,
      pulse.startOffset,
      pulse.startOffset + 1,
    );
    const radius = Math.max(
      textPulseBaseRadius,
      (right - left) / 2 + textPulseBaseRadius + textPulseRadiusGrowth * pulse.progress,
    );
    const { ascent, descent } = resolveFontMetrics(layoutLine.font);
    const glyphCenterY =
      lineFrame.textBaseline - Math.max(1, ascent * 0.42) + Math.max(0.5, descent * 0.15);
    const color = fadeCanvasColor(theme.insertHighlightText, pulse.progress);

    paintEffect(
      pulse,
      {
        anchor: {
          x: left,
          y: lineFrame.textBaseline,
        },
        contentKind: pulse.contentKind,
        progress: pulse.progress,
        text: pulse.text,
      },
      ({ context }) => {
        context.strokeStyle = color;
        context.lineWidth = textPulseStrokeWidth;
        context.beginPath();
        context.arc((left + right) / 2, glyphCenterY, radius, 0, Math.PI * 2);
        context.stroke();
      },
    );
  }
}

function isTextGraphemeBoundary(text: string, startOffset: number, offset: number) {
  const localOffset = offset - startOffset;

  if (localOffset <= 0 || localOffset >= text.length) {
    return true;
  }

  let cursor = 0;

  for (const grapheme of splitGraphemes(text)) {
    cursor += grapheme.length;
    if (cursor === localOffset) {
      return true;
    }
    if (cursor > localOffset) {
      return false;
    }
  }

  return false;
}
