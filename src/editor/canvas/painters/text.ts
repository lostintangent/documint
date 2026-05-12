// Owns line text rendering: the per-inline text, inline code background,
// strikethrough/underline decorations, and effect overlays that draw directly
// into glyph space (insert highlights, text fades, text pulses). Inline
// images are drawn here too via a delegate so the inline iteration stays linear.

import { measureLineOffsetLeft, type DocumentLayout } from "../../layout";
import type { EditorRegion } from "../../state";
import type { DocumentResources, EditorTheme } from "@/types";
import { resolveMarkedTextFont } from "../../text/fonts";
import {
  resolveActiveTextHighlightForSegment,
  resolveTextFadeColor,
  resolveTextHighlightSegmentBoundaries,
  resolveTextPulseColor,
  type ActiveTextFade,
  type ActiveTextHighlight,
  type ActiveTextPulse,
} from "../lib/animations";
import {
  resolveCanvasCenteredTextBaseline,
  resolveCanvasCenteredTextTop,
  resolveCanvasFontMetrics,
} from "../lib/fonts";
import { paintInlineImage } from "./image";
import { paintInlineMention } from "./mention";
import { splitGraphemes } from "../../text/graphemes";

const inlineCodeBackgroundBottomInset = 6;
const inlineCodeBackgroundHorizontalPadding = 3;
const inlineCodeBackgroundMinimumHeight = 12;
const inlineCodeBackgroundMinimumWidth = 10;
const inlineCodeBackgroundTopInset = 2;
const textPulseBaseRadius = 4;
const textPulseRadiusGrowth = 4;
const textPulseStrokeWidth = 1.5;
const textDecorationMinimumWidth = 2;
const textDecorationThickness = 1.25;
const textHighlightMinimumVisibleAlpha = 0.02;

export function paintCanvasLineText(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: EditorRegion | null,
  textLeft: number,
  textBaseline: number,
  defaultColor: string,
  resources: DocumentResources,
  theme: EditorTheme,
) {
  if (!container) {
    context.fillStyle = defaultColor;
    context.fillText(line.text, textLeft, textBaseline);
    return;
  }

  const visibleInlines = container.inlines.filter(
    (inline) => inline.end > line.start && inline.start < line.end,
  );

  if (visibleInlines.length === 0) {
    context.fillStyle = defaultColor;
    context.fillText(line.text, textLeft, textBaseline);
    return;
  }

  for (const inline of visibleInlines) {
    const start = Math.max(line.start, inline.start);
    const end = Math.min(line.end, inline.end);
    const segmentText = container.text.slice(start, end);

    if (segmentText.length === 0) {
      continue;
    }

    const { left: segmentLeft, right: segmentRight } = resolveLineSegmentBounds(
      line,
      textLeft,
      start,
      end,
    );
    const inlineFont = resolveMarkedTextFont(line.font, inline.marks);
    context.font = inlineFont;

    if (inline.kind === "image") {
      const imageWidth = Math.max(24, segmentRight - segmentLeft);
      paintInlineImage(context, line, inline, resources, theme, segmentLeft, imageWidth);
      continue;
    }

    if (inline.kind === "mention") {
      paintInlineMention(context, line, inline, theme, segmentLeft, segmentRight);
      continue;
    }

    if (inline.kind === "code") {
      paintInlineCodeBackground(context, line, inlineFont, theme, segmentLeft, segmentRight);
      paintTextInlineSegments(
        context,
        line,
        container.text,
        textLeft,
        textBaseline,
        start,
        end,
        theme.inlineCodeText,
        {
          strikethrough: false,
          underline: false,
        },
      );
      continue;
    }

    paintTextInlineSegments(
      context,
      line,
      container.text,
      textLeft,
      textBaseline,
      start,
      end,
      inline.link ? theme.linkText : defaultColor,
      {
        strikethrough: inline.marks.includes("strikethrough"),
        underline: inline.marks.includes("underline") || Boolean(inline.link),
      },
    );
  }
}

function paintTextInlineSegments(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  containerText: string,
  textLeft: number,
  textBaseline: number,
  startOffset: number,
  endOffset: number,
  baseColor: string,
  decorations: {
    strikethrough: boolean;
    underline: boolean;
  },
) {
  const segmentBoundaries = [startOffset, endOffset];

  for (let index = 0; index < segmentBoundaries.length - 1; index += 1) {
    const segmentStart = segmentBoundaries[index]!;
    const segmentEnd = segmentBoundaries[index + 1]!;

    if (segmentEnd <= segmentStart) {
      continue;
    }

    const segmentText = containerText.slice(segmentStart, segmentEnd);

    if (segmentText.length === 0) {
      continue;
    }

    const { left: segmentLeft, right: segmentRight } = resolveLineSegmentBounds(
      line,
      textLeft,
      segmentStart,
      segmentEnd,
    );
    context.fillStyle = baseColor;
    context.fillText(segmentText, segmentLeft, textBaseline);

    if (decorations.strikethrough) {
      context.fillRect(
        segmentLeft,
        resolveStrikethroughTop(textBaseline, line.height, context.font),
        Math.max(textDecorationMinimumWidth, segmentRight - segmentLeft),
        textDecorationThickness,
      );
    }

    if (decorations.underline) {
      context.fillRect(
        segmentLeft,
        resolveCanvasTextDecorationTop(textBaseline, line.height, context.font),
        Math.max(textDecorationMinimumWidth, segmentRight - segmentLeft),
        textDecorationThickness,
      );
    }
  }
}

export function paintCanvasTextHighlights(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: EditorRegion | null,
  textLeft: number,
  textBaseline: number,
  textHighlights: ActiveTextHighlight[],
  theme: EditorTheme,
) {
  if (!container || textHighlights.length === 0) {
    return;
  }

  const visibleInlines = container.inlines.filter(
    (inline) => inline.end > line.start && inline.start < line.end,
  );

  for (const inline of visibleInlines) {
    if (inline.kind === "image" || inline.kind === "mention") {
      continue;
    }

    const start = Math.max(line.start, inline.start);
    const end = Math.min(line.end, inline.end);
    const segmentText = container.text.slice(start, end);

    if (segmentText.length === 0) {
      continue;
    }

    const highlightBoundaries = resolveTextHighlightSegmentBoundaries(
      start,
      end,
      textHighlights,
    ).filter((offset) => isTextGraphemeBoundary(container.text, start, end, offset));

    if (highlightBoundaries.length <= 2) {
      const activeHighlight = resolveActiveTextHighlightForSegment(textHighlights, start, end);

      if (!activeHighlight) {
        continue;
      }
    }

    const { left: segmentLeft } = resolveLineSegmentBounds(line, textLeft, start, end);
    const inlineFont = resolveMarkedTextFont(line.font, inline.marks);
    context.font = inlineFont;

    for (let index = 0; index < highlightBoundaries.length - 1; index += 1) {
      const highlightStart = highlightBoundaries[index]!;
      const highlightEnd = highlightBoundaries[index + 1]!;
      const activeHighlight = resolveActiveTextHighlightForSegment(
        textHighlights,
        highlightStart,
        highlightEnd,
      );

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

      context.save();
      context.beginPath();
      context.rect(
        highlightLeft,
        line.top,
        Math.max(0, highlightRight - highlightLeft),
        line.height,
      );
      context.clip();
      context.globalAlpha *= alpha;
      context.fillStyle = theme.insertHighlightText;
      context.fillText(segmentText, segmentLeft, textBaseline);
      context.restore();
    }
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

export function paintCanvasTextFades(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: EditorRegion | null,
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

export function paintCanvasTextPulses(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: EditorRegion | null,
  textLeft: number,
  textBaseline: number,
  textPulses: ActiveTextPulse[],
  theme: EditorTheme,
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
      (right - left) / 2 +
        textPulseBaseRadius +
        textPulseRadiusGrowth * pulse.progress,
    );
    const { ascent, descent } = resolveCanvasFontMetrics(line.font);
    const glyphCenterY = textBaseline - Math.max(1, ascent * 0.42) + Math.max(0.5, descent * 0.15);

    context.strokeStyle = resolveTextPulseColor(pulse, theme);
    context.lineWidth = textPulseStrokeWidth;
    context.beginPath();
    context.arc((left + right) / 2, glyphCenterY, radius, 0, Math.PI * 2);
    context.stroke();
  }
}

function paintInlineCodeBackground(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  font: string,
  theme: EditorTheme,
  segmentLeft: number,
  segmentRight: number,
) {
  const lineTextTop = resolveCanvasCenteredTextTop(line.height, font);
  const top = line.top + lineTextTop + inlineCodeBackgroundTopInset;
  const height = Math.max(
    inlineCodeBackgroundMinimumHeight,
    line.height - lineTextTop - inlineCodeBackgroundBottomInset,
  );

  context.fillStyle = theme.inlineCodeBackground;
  context.fillRect(
    segmentLeft - inlineCodeBackgroundHorizontalPadding,
    top,
    Math.max(
      inlineCodeBackgroundMinimumWidth,
      segmentRight - segmentLeft + inlineCodeBackgroundHorizontalPadding * 2,
    ),
    height,
  );
}

function resolveStrikethroughTop(textBaseline: number, lineHeight: number, font: string) {
  const { ascent } = resolveCanvasFontMetrics(font);
  const lineTop = textBaseline - resolveCanvasCenteredTextBaseline(lineHeight, font);

  return Math.max(lineTop + 2, textBaseline - Math.round(ascent * 0.32));
}

function resolveCanvasTextDecorationTop(textBaseline: number, lineHeight: number, font: string) {
  const { descent } = resolveCanvasFontMetrics(font);
  const descentInset = Math.max(1, Math.round(Math.max(2, descent) * 0.35));
  const glyphBottom = textBaseline + descent - descentInset;
  const lineTop = textBaseline - resolveCanvasCenteredTextBaseline(lineHeight, font);

  return Math.min(lineTop + lineHeight - 4, glyphBottom);
}

function resolveLineSegmentBounds(
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
