// Owns transient text effects: insert highlights (a flash that fades over
// freshly typed text), text fades (ghost text for deletions), and text
// pulses (a radial ping at a punctuation insertion point). Each effect
// reads its descriptor list from the orchestrator, filters to the current
// line, and paints its overlay. All three sit on top of the settled text
// runs so they paint last in the foreground sub-pipeline.

import { splitGraphemes } from "@/editor/text/graphemes";
import { resolveFontMetrics } from "@/editor/text/measure";
import { collectRangeBoundaries, findRangeAtSegment } from "@/editor/text/ranges";
import type { DocumentFrameLine } from "@/renderer/frame";
import type { TextRunSegment, TextSegment } from "@/renderer/frame/line/text-segments";
import { resolveLineSegmentBounds } from "@/renderer/frame/line/text-geometry";
import type { TextDeletedEffectContext } from "@/types";
import {
  resolveTextFadeColor,
  resolveTextPulseColor,
  type ActiveTextFade,
  type ActiveTextHighlight,
  type ActiveTextPulse,
  type EffectEnvironment,
  type PaintEffect,
} from "../../effects";
import { paintClippedTextOverlay } from "./glyphs";

const textPulseBaseRadius = 4;
const textPulseRadiusGrowth = 4;
const textPulseStrokeWidth = 1.5;
const textHighlightMinimumVisibleAlpha = 0.02;

export function paintTextHighlights(
  lineFrame: DocumentFrameLine,
  textHighlights: readonly ActiveTextHighlight[],
  environment: EffectEnvironment & { paintEffect: PaintEffect },
) {
  const { context, paintEffect, theme } = environment;

  if (textHighlights.length === 0) {
    return;
  }

  forEachTextRunSegment(lineFrame, (textSegment) => {
    if (textSegment.text.length === 0) {
      return;
    }

    const highlightBoundaries = collectRangeBoundaries(
      textSegment.start,
      textSegment.end,
      textHighlights,
    ).filter((offset) => isTextGraphemeBoundary(textSegment.text, textSegment.start, offset));

    if (highlightBoundaries.length <= 2) {
      const activeHighlight = findRangeAtSegment(
        textHighlights,
        textSegment.start,
        textSegment.end,
      );

      if (!activeHighlight) {
        return;
      }
    }

    context.font = textSegment.font;

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
        lineFrame.layoutLine,
        lineFrame.textLeft,
        highlightStart,
        highlightEnd,
      );
      const width = Math.max(0, highlightRight - highlightLeft);

      paintEffect(
        "textInserted",
        {
          anchor: {
            x: highlightLeft,
            y: textSegment.baseline,
          },
          progress: activeHighlight.progress,
          text: activeHighlight.text,
        },
        ({ context }) => {
          paintDefaultTextInsertedHighlight(context, {
            alpha,
            color: theme.insertHighlightText,
            height: lineFrame.layoutLine.height,
            left: highlightLeft,
            text: textSegment.text,
            textBaseline: textSegment.baseline,
            textLeft: textSegment.left,
            top: lineFrame.layoutLine.top,
            width,
          });
        },
      );
    }
  });
}

function paintDefaultTextInsertedHighlight(
  context: CanvasRenderingContext2D,
  {
    alpha,
    color,
    height,
    left,
    text,
    textBaseline,
    textLeft,
    top,
    width,
  }: {
    alpha: number;
    color: string;
    height: number;
    left: number;
    text: string;
    textBaseline: number;
    textLeft: number;
    top: number;
    width: number;
  },
) {
  paintClippedTextOverlay(context, {
    alpha,
    color,
    height,
    left,
    text,
    textBaseline,
    textLeft,
    top,
    width,
  });
}

export function paintTextFades(
  lineFrame: DocumentFrameLine,
  textFades: readonly ActiveTextFade[],
  environment: EffectEnvironment & { paintEffect: PaintEffect },
) {
  const { paintEffect } = environment;

  if (textFades.length === 0) {
    return;
  }

  for (const fade of textFades) {
    if (!isOffsetInLine(lineFrame, fade.startOffset, "include-end")) {
      continue;
    }

    const { left: ghostLeft } = resolveLineSegmentBounds(
      lineFrame.layoutLine,
      lineFrame.textLeft,
      fade.startOffset,
      fade.startOffset,
    );

    const color = resolveTextFadeColor(lineFrame.defaultTextColor, fade);

    paintEffect(
      "textDeleted",
      {
        color,
        font: lineFrame.layoutLine.font,
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
  textPulses: readonly ActiveTextPulse[],
  environment: EffectEnvironment & { paintEffect: PaintEffect },
) {
  const { paintEffect, theme } = environment;

  if (textPulses.length === 0) {
    return;
  }

  for (const pulse of textPulses) {
    if (!isOffsetInLine(lineFrame, pulse.startOffset, "exclude-end")) {
      continue;
    }

    const { left, right } = resolveLineSegmentBounds(
      lineFrame.layoutLine,
      lineFrame.textLeft,
      pulse.startOffset,
      pulse.startOffset + 1,
    );
    const radius = Math.max(
      textPulseBaseRadius,
      (right - left) / 2 + textPulseBaseRadius + textPulseRadiusGrowth * pulse.progress,
    );
    const { ascent, descent } = resolveFontMetrics(lineFrame.layoutLine.font);
    const glyphCenterY =
      lineFrame.textBaseline - Math.max(1, ascent * 0.42) + Math.max(0.5, descent * 0.15);
    const color = resolveTextPulseColor(pulse, theme);

    paintEffect(
      "textInserted",
      {
        anchor: {
          x: left,
          y: lineFrame.textBaseline,
        },
        progress: pulse.progress,
        text: pulse.text,
      },
      ({ context }) => {
        paintDefaultTextInsertedPulse(context, {
          centerX: (left + right) / 2,
          centerY: glyphCenterY,
          color,
          radius,
        });
      },
    );
  }
}

function paintDefaultTextInsertedPulse(
  context: CanvasRenderingContext2D,
  {
    centerX,
    centerY,
    color,
    radius,
  }: {
    centerX: number;
    centerY: number;
    color: string;
    radius: number;
  },
) {
  context.strokeStyle = color;
  context.lineWidth = textPulseStrokeWidth;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.stroke();
}

function forEachTextRunSegment(
  lineFrame: DocumentFrameLine,
  visit: (textSegment: TextRunSegment) => void,
) {
  for (const textSegment of lineFrame.segments) {
    if (isTextRunSegment(textSegment)) {
      visit(textSegment);
    }
  }
}

function isTextRunSegment(textSegment: TextSegment): textSegment is TextRunSegment {
  return textSegment.atom === "text" || textSegment.atom === "inline-code";
}

function isOffsetInLine(
  lineFrame: DocumentFrameLine,
  offset: number,
  endBoundary: "exclude-end" | "include-end",
) {
  return (
    offset >= lineFrame.layoutLine.start &&
    (endBoundary === "include-end"
      ? offset <= lineFrame.layoutLine.end
      : offset < lineFrame.layoutLine.end)
  );
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
