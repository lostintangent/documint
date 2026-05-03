// Owns line text rendering: the per-run text, inline code background,
// strikethrough/underline decorations, and the two effect overlays that draw
// directly into glyph space (deleted-text fades, punctuation pulses). Inline
// images are drawn here too via a delegate so the run iteration stays linear.

import type { Mark } from "@/document";
import { measureLineOffsetLeft, type DocumentLayout } from "../../layout";
import type { EditorRegion } from "../../state";
import type { DocumentResources, EditorTheme } from "@/types";
import {
  resolveActiveInsertedTextHighlightForSegment,
  resolveAnimatedTextColor,
  resolveDeletedTextFadeColor,
  resolveInsertHighlightSegmentBoundaries,
  resolvePunctuationPulseColor,
  type ActiveDeletedTextFade,
  type ActiveInsertedTextHighlight,
  type ActivePunctuationPulse,
} from "../lib/animations";
import {
  resolveCanvasCenteredTextBaseline,
  resolveCanvasCenteredTextTop,
  resolveCanvasFontMetrics,
} from "../lib/fonts";
import { paintInlineImage } from "./image";

const inlineCodeBackgroundBottomInset = 6;
const inlineCodeBackgroundHorizontalPadding = 3;
const inlineCodeBackgroundMinimumHeight = 12;
const inlineCodeBackgroundMinimumWidth = 10;
const inlineCodeBackgroundTopInset = 2;
const punctuationPulseBaseRadius = 4;
const punctuationPulseRadiusGrowth = 4;
const punctuationPulseStrokeWidth = 1.5;
const textDecorationMinimumWidth = 2;
const textDecorationThickness = 1.25;

export function paintCanvasLineText(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: EditorRegion | null,
  textLeft: number,
  textBaseline: number,
  insertedTextHighlights: ActiveInsertedTextHighlight[],
  defaultColor: string,
  resources: DocumentResources,
  theme: EditorTheme,
) {
  if (!container) {
    context.fillStyle = defaultColor;
    context.fillText(line.text, textLeft, textBaseline);
    return;
  }

  const visibleRuns = container.inlines.filter(
    (run) => run.end > line.start && run.start < line.end,
  );

  if (visibleRuns.length === 0) {
    context.fillStyle = defaultColor;
    context.fillText(line.text, textLeft, textBaseline);
    return;
  }

  for (const run of visibleRuns) {
    const start = Math.max(line.start, run.start);
    const end = Math.min(line.end, run.end);
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
    const runFont = resolveCanvasInlineFont(line.font, run.marks);
    context.font = runFont;

    if (run.kind === "image") {
      const imageWidth = Math.max(24, segmentRight - segmentLeft);
      paintInlineImage(context, line, run, resources, theme, segmentLeft, imageWidth);
      continue;
    }

    if (run.kind === "code") {
      paintInlineCodeBackground(context, line, runFont, theme, segmentLeft, segmentRight);
      paintTextRunSegments(
        context,
        line,
        container.text,
        textLeft,
        textBaseline,
        start,
        end,
        theme.inlineCodeText,
        insertedTextHighlights,
        theme,
        {
          strikethrough: false,
          underline: false,
        },
      );
      continue;
    }

    paintTextRunSegments(
      context,
      line,
      container.text,
      textLeft,
      textBaseline,
      start,
      end,
      run.link ? theme.linkText : defaultColor,
      insertedTextHighlights,
      theme,
      {
        strikethrough: run.marks.includes("strikethrough"),
        underline: run.marks.includes("underline") || Boolean(run.link),
      },
    );
  }
}

function paintTextRunSegments(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  containerText: string,
  textLeft: number,
  textBaseline: number,
  startOffset: number,
  endOffset: number,
  baseColor: string,
  insertedTextHighlights: ActiveInsertedTextHighlight[],
  theme: EditorTheme,
  decorations: {
    strikethrough: boolean;
    underline: boolean;
  },
) {
  const segmentBoundaries = resolveInsertHighlightSegmentBoundaries(
    startOffset,
    endOffset,
    insertedTextHighlights,
  );

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
    const activeHighlight = resolveActiveInsertedTextHighlightForSegment(
      insertedTextHighlights,
      segmentStart,
      segmentEnd,
    );
    const textColor = resolveAnimatedTextColor(baseColor, activeHighlight, theme);

    context.fillStyle = textColor;
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

export function paintCanvasDeletedTextFades(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: EditorRegion | null,
  textLeft: number,
  textBaseline: number,
  deletedTextFades: ActiveDeletedTextFade[],
  baseColor: string,
) {
  if (!container || deletedTextFades.length === 0) {
    return;
  }

  for (const fade of deletedTextFades) {
    if (fade.startOffset < line.start || fade.startOffset > line.end) {
      continue;
    }

    const ghostLeft =
      textLeft + (measureLineOffsetLeft(line, fade.startOffset - line.start) - line.left);

    context.fillStyle = resolveDeletedTextFadeColor(baseColor, fade);
    context.fillText(fade.text, ghostLeft, textBaseline);
  }
}

export function paintCanvasPunctuationPulses(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: EditorRegion | null,
  textLeft: number,
  textBaseline: number,
  punctuationPulses: ActivePunctuationPulse[],
  theme: EditorTheme,
) {
  if (!container || punctuationPulses.length === 0) {
    return;
  }

  for (const pulse of punctuationPulses) {
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
      punctuationPulseBaseRadius,
      (right - left) / 2 +
        punctuationPulseBaseRadius +
        punctuationPulseRadiusGrowth * pulse.progress,
    );
    const { ascent, descent } = resolveCanvasFontMetrics(line.font);
    const glyphCenterY = textBaseline - Math.max(1, ascent * 0.42) + Math.max(0.5, descent * 0.15);

    context.strokeStyle = resolvePunctuationPulseColor(pulse, theme);
    context.lineWidth = punctuationPulseStrokeWidth;
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

function resolveCanvasInlineFont(font: string, marks: Mark[]) {
  const parts: string[] = [];

  if (marks.includes("italic")) {
    parts.push("italic");
  }

  if (marks.includes("bold")) {
    parts.push("700");
  }

  return parts.length > 0 ? `${parts.join(" ")} ${font}` : font;
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
