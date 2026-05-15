// Owns line text rendering: the per-inline text, inline code background,
// strikethrough/underline decorations, and effect overlays that draw directly
// into glyph space (insert highlights, text fades, text pulses). Inline
// images are drawn here too via a delegate so the inline iteration stays linear.

import { measureLineOffsetLeft, type DocumentLayout } from "../../layout";
import type { EditorInline, EditorRegion } from "../../state";
import type { DocumentResources, EditorTheme } from "@/types";
import { resolveInlineTextFont, resolveMarkedTextFont } from "../../text/fonts";
import type { TextDecoration } from "../../text/decorations";
import {
  resolveActiveTextHighlightForSegment,
  resolveTextFadeColor,
  resolveTextHighlightSegmentBoundaries,
  resolveTextPulseColor,
  type ActiveTextFade,
  type ActiveTextHighlight,
  type ActiveTextPulse,
} from "../lib/animations";
import { blendCanvasColors } from "../lib/colors";
import { resolveCanvasCenteredTextBaseline, resolveCanvasFontMetrics } from "../lib/fonts";
import {
  resolveRestingPulseAlpha,
  resolveRestingPulseProgress,
  restingPulseMinimumAlpha,
} from "../lib/pulse";
import { paintInlineImage } from "./image";
import { paintInlineMention } from "./mention";
import { splitGraphemes } from "../../text/graphemes";

const textPulseBaseRadius = 4;
const textPulseRadiusGrowth = 4;
const textPulseStrokeWidth = 1.5;
const editableTextBackgroundGeometry = {
  bottomPadding: 1,
  cornerRadius: 0,
  horizontalPadding: 1,
  topPadding: 2,
  verticalNudge: -1,
} as const;
const decorationPulseTextMaximumBaseBlend = 0.72;
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
    const inlineFont = resolveInlineTextFont(line.font, inline.marks, inline.inlineCode);
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
      paintTextBackground(
        context,
        segmentLeft,
        segmentRight,
        textBaseline,
        theme.inlineCodeBackground,
        editableTextBackgroundGeometry,
      );
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
  const segmentText = containerText.slice(startOffset, endOffset);

  if (segmentText.length === 0) {
    return;
  }

  const { left: segmentLeft, right: segmentRight } = resolveLineSegmentBounds(
    line,
    textLeft,
    startOffset,
    endOffset,
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

  const lineDecorations = resolveOverlappingTextDecorations(textDecorations, line.start, line.end);

  if (lineDecorations.length === 0) {
    return;
  }

  const visibleInlines = container.inlines.filter(
    (inline) => inline.end > line.start && inline.start < line.end,
  );

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

    const segmentDecorations = resolveOverlappingTextDecorations(lineDecorations, start, end);

    if (segmentDecorations.length === 0) {
      continue;
    }

    const decorationBoundaries = resolveTextDecorationBoundaries(start, end, segmentDecorations);

    const { left: segmentLeft } = resolveLineSegmentBounds(line, textLeft, start, end);
    context.font = resolveMarkedTextFont(line.font, inline.marks);

    for (let index = 0; index < decorationBoundaries.length - 1; index += 1) {
      const decorationStart = decorationBoundaries[index]!;
      const decorationEnd = decorationBoundaries[index + 1]!;
      const textDecoration = resolveTextDecorationForSegment(
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

      paintTextDecorationSegment(context, {
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

function resolveOverlappingTextDecorations(
  textDecorations: readonly TextDecoration[],
  startOffset: number,
  endOffset: number,
) {
  return textDecorations.filter(
    (decoration) => decoration.endOffset > startOffset && decoration.startOffset < endOffset,
  );
}

function resolveTextDecorationBoundaries(
  startOffset: number,
  endOffset: number,
  textDecorations: readonly TextDecoration[],
) {
  if (textDecorations.length === 0) return [startOffset, endOffset];

  const boundaries = new Set([startOffset, endOffset]);

  for (const decoration of textDecorations) {
    if (decoration.endOffset <= startOffset || decoration.startOffset >= endOffset) {
      continue;
    }

    boundaries.add(Math.max(startOffset, decoration.startOffset));
    boundaries.add(Math.min(endOffset, decoration.endOffset));
  }

  return [...boundaries].sort((a, b) => a - b);
}

function resolveTextDecorationForSegment(
  textDecorations: readonly TextDecoration[],
  startOffset: number,
  endOffset: number,
) {
  return (
    textDecorations.find(
      (decoration) => decoration.startOffset < endOffset && decoration.endOffset > startOffset,
    ) ?? null
  );
}

function paintTextDecorationSegment(
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

function paintTextBackground(
  context: CanvasRenderingContext2D,
  left: number,
  right: number,
  textBaseline: number,
  color: string,
  geometry: TextBackgroundGeometry,
) {
  const backgroundBounds = resolveTextBackgroundBounds(
    context,
    left,
    right,
    textBaseline,
    geometry,
  );

  context.fillStyle = color;
  if (geometry.cornerRadius <= 0) {
    context.fillRect(
      backgroundBounds.left,
      backgroundBounds.top,
      backgroundBounds.width,
      backgroundBounds.height,
    );
    return;
  }

  paintRoundedRect(
    context,
    backgroundBounds.left,
    backgroundBounds.top,
    backgroundBounds.width,
    backgroundBounds.height,
    geometry.cornerRadius,
  );
}

function resolveTextBackgroundBounds(
  context: CanvasRenderingContext2D,
  left: number,
  right: number,
  textBaseline: number,
  geometry: TextBackgroundGeometry,
) {
  const fontMetrics = resolveCanvasFontMetrics(context.font);
  const paddedLeft = left - geometry.horizontalPadding;
  const paddedRight = right + geometry.horizontalPadding;

  return {
    height: fontMetrics.ascent + fontMetrics.descent + geometry.topPadding + geometry.bottomPadding,
    left: paddedLeft,
    top: textBaseline - fontMetrics.ascent - geometry.topPadding + geometry.verticalNudge,
    width: Math.max(0, paddedRight - paddedLeft),
  };
}

type TextBackgroundGeometry = {
  bottomPadding: number;
  cornerRadius: number;
  horizontalPadding: number;
  topPadding: number;
  verticalNudge: number;
};

function paintRoundedRect(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
) {
  if (width <= 0 || height <= 0) {
    return;
  }

  context.beginPath();
  context.roundRect(left, top, width, height, Math.min(radius, width / 2, height / 2));
  context.fill();
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
    const inlineFont = resolveInlineTextFont(line.font, inline.marks, inline.inlineCode);
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

      paintClippedTextOverlay(context, {
        alpha,
        color: theme.insertHighlightText,
        height: line.height,
        left: highlightLeft,
        text: segmentText,
        textBaseline,
        textLeft: segmentLeft,
        top: line.top,
        width: Math.max(0, highlightRight - highlightLeft),
      });
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
      (right - left) / 2 + textPulseBaseRadius + textPulseRadiusGrowth * pulse.progress,
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

function paintClippedTextOverlay(
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
