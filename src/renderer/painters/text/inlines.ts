// Owns per-line text run rendering. Walks the visible inlines on a line and
// dispatches each by `kind`: references go to their dedicated
// painters; inline code paints a code background plus monospace glyphs;
// everything else paints as styled text with strikethrough/underline as
// needed. Reference dispatch lives here so the inline iteration
// stays linear — the alternative would split inline visibility resolution
// across several files.

import type { DocumentLayout } from "@/editor/layout";
import { findInlinesInSpan, regionInlines, type RegionEntry } from "@/editor/state";
import type { DocumentResources, ResolvedEditorTheme } from "@/types";
import { resolveInlineTextStyle } from "@/editor/text/fonts";
import { paintInlineImage } from "../image";
import { paintInlineMention } from "../mention";
import { paintInlineResource } from "../resource";
import {
  editableTextBackgroundGeometry,
  paintTextBackground,
  resolveLineSegmentBounds,
  resolveStrikethroughTop,
  resolveUnderlineTop,
  textDecorationMinimumWidth,
  textDecorationThickness,
} from "./glyphs";

export function paintLineText(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  container: RegionEntry | null,
  textLeft: number,
  textBaseline: number,
  defaultColor: string,
  resources: DocumentResources,
  theme: ResolvedEditorTheme,
  ambientAnimationTime: number,
) {
  if (!container) {
    context.fillStyle = defaultColor;
    context.fillText(line.text, textLeft, textBaseline);
    return;
  }

  const visibleInlines = findInlinesInSpan(regionInlines(container), line.start, line.end);

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
    const inlineMarks = inline.node.type === "text" ? inline.node.marks : [];
    const inlineStyle = resolveInlineTextStyle(line.font, inlineMarks, inline.node.type === "code");
    context.font = inlineStyle.font;
    const segmentBaseline = textBaseline + inlineStyle.baselineShift;

    if (inline.node.type === "image") {
      const imageWidth = Math.max(24, segmentRight - segmentLeft);
      paintInlineImage(
        context,
        line,
        inline,
        resources,
        theme,
        segmentLeft,
        imageWidth,
        ambientAnimationTime,
      );
      continue;
    }

    if (inline.node.type === "mention") {
      paintInlineMention(context, line, inline, theme, segmentLeft, segmentRight);
      continue;
    }

    if (inline.node.type === "resource") {
      paintInlineResource(
        context,
        line,
        inline,
        resources,
        theme,
        segmentLeft,
        segmentRight,
        ambientAnimationTime,
      );
      continue;
    }

    if (inline.node.type === "code") {
      paintTextBackground(
        context,
        segmentLeft,
        segmentRight,
        segmentBaseline,
        theme.inlineCodeBackground,
        editableTextBackgroundGeometry,
      );
      paintInlineSegment(
        context,
        line,
        container.text,
        textLeft,
        segmentBaseline,
        start,
        end,
        theme.inlineCodeText,
        { strikethrough: false, underline: false },
      );
      continue;
    }

    paintInlineSegment(
      context,
      line,
      container.text,
      textLeft,
      segmentBaseline,
      start,
      end,
      inline.link ? theme.linkText : defaultColor,
      {
        strikethrough: inlineMarks.includes("strikethrough"),
        underline: inlineMarks.includes("underline") || Boolean(inline.link),
      },
    );
  }
}

function paintInlineSegment(
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
      resolveUnderlineTop(textBaseline, line.height, context.font),
      Math.max(textDecorationMinimumWidth, segmentRight - segmentLeft),
      textDecorationThickness,
    );
  }
}
