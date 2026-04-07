// Owns text measurement for render layout. This module resolves block
// typography, wraps editor text regions into measured lines, and produces
// grapheme boundaries for caret placement and hit testing.

import { layoutWithLines, prepareWithSegments, type PrepareOptions } from "@chenglou/pretext";
import type { Block, Mark } from "@/document";
import type { DocumentResources } from "../resources";
import type {
  DocumentEditorRegion,
  DocumentEditorTextRun,
} from "../model/document-editor";
import {
  resolveInlineImageDimensions,
  resolveInlineImageSignature,
} from "./image";
import {
  cacheLineBoundaries,
  cacheMeasuredLines,
  cachePreparedText,
  getOrCreateGraphemeWidthCache,
  type CanvasRenderCache,
} from "../render/cache";

export type TextLineBoundary = {
  left: number;
  offset: number;
};

type MeasuredTextLine = {
  end: number;
  height: number;
  start: number;
  text: string;
  width: number;
};

type MeasuredTextSegment = {
  breakable: boolean;
  end: number;
  height: number;
  start: number;
  text: string;
  width: number;
};

const headingTypographyScale = [
  { fontSize: 32, lineHeight: 36 },
  { fontSize: 26, lineHeight: 32 },
  { fontSize: 21, lineHeight: 28 },
  { fontSize: 21, lineHeight: 28 },
  { fontSize: 19, lineHeight: 26 },
  { fontSize: 18, lineHeight: 26 },
] as const;

let textMeasurementContext: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null | undefined;

export function resolveTextBlockFont(block: Block | null) {
  if (block?.type === "heading") {
    const { fontSize } = resolveHeadingTypography(block.depth);

    return `700 ${fontSize}px "Iowan Old Style", "Palatino Linotype", serif`;
  }

  switch (block?.type) {
    case "code":
      return '15px ui-monospace, SFMono-Regular, Menlo, monospace';
    default:
      return '16px "Iowan Old Style", "Palatino Linotype", serif';
  }
}

export function resolveTextBlockLineHeight(block: Block | null, fallback: number) {
  if (block?.type === "heading") {
    return resolveHeadingTypography(block.depth).lineHeight;
  }

  if (block?.type === "code") {
    return 22;
  }

  return fallback;
}

function resolveHeadingTypography(depth: number) {
  return headingTypographyScale[depth - 1] ?? headingTypographyScale.at(-1)!;
}

export function measureTextContainerLines(
  cache: CanvasRenderCache,
  container: DocumentEditorRegion,
  font: string,
  block: Block | null,
  availableWidth: number,
  lineHeight: number,
  resources: DocumentResources,
) {
  const measurementSignature = resolveContainerMeasurementSignature(container, resources);
  const cacheKey = `${container.id}:${availableWidth}:${lineHeight}:${font}:${measurementSignature}`;
  const cached = cache.measuredLines.get(cacheKey);

  if (cached) {
    return cached;
  }

  const measuredLines = createMeasuredTextLines(
    cache,
    container,
    font,
    block,
    availableWidth,
    lineHeight,
    resources,
  );

  return cacheMeasuredLines(cache, cacheKey, measuredLines);
}

export function measureTextLineBoundaries(
  cache: CanvasRenderCache,
  container: DocumentEditorRegion,
  start: number,
  end: number,
  text: string,
  font: string,
  availableWidth: number,
  resources: DocumentResources,
): TextLineBoundary[] {
  const measurementSignature = resolveContainerMeasurementSignature(container, resources);
  const cacheKey = `${container.id}:${start}:${end}:${font}:${availableWidth}:${measurementSignature}`;
  const cached = cache.lineBoundaries.get(cacheKey);

  if (cached) {
    return cached;
  }

  const context = getTextMeasurementContext();

  if (!context) {
    return createFallbackLineBoundaries(text);
  }

  const boundaries: TextLineBoundary[] = [
    {
      left: 0,
      offset: 0,
    },
  ];
  let width = 0;
  const visibleRuns = container.runs.filter((run) => run.end > start && run.start < end);

  if (visibleRuns.length === 0) {
    return createFallbackLineBoundaries(text);
  }

  for (const run of visibleRuns) {
    const segmentStart = Math.max(start, run.start);
    const segmentEnd = Math.min(end, run.end);
    const segmentText = container.text.slice(segmentStart, segmentEnd);
    let offset = segmentStart - start;

    if (run.kind === "image") {
      const imageWidth = resolveInlineImageDimensions(run, resources, availableWidth).width;
      width += imageWidth;
      offset += segmentText.length;
      boundaries.push({
        left: width,
        offset,
      });

      continue;
    }

    context.font = resolveInlineFont(font, run.marks);

    for (const grapheme of Array.from(segmentText)) {
      width += measureGraphemeWidth(cache, context, grapheme);
      offset += grapheme.length;
      boundaries.push({
        left: width,
        offset,
      });
    }
  }

  return cacheLineBoundaries(cache, cacheKey, boundaries);
}

function prepareTextSegments(
  cache: CanvasRenderCache,
  text: string,
  font: string,
  whiteSpace: NonNullable<PrepareOptions["whiteSpace"]>,
) {
  const cacheKey = `${font}::${whiteSpace}::${text}`;
  const cached = cache.preparedText.get(cacheKey);

  if (cached) {
    return cached;
  }

  const prepared = prepareWithSegments(text, font, {
    whiteSpace,
  });

  return cachePreparedText(cache, cacheKey, prepared);
}

function createMeasuredTextLines(
  cache: CanvasRenderCache,
  container: DocumentEditorRegion,
  font: string,
  block: Block | null,
  availableWidth: number,
  lineHeight: number,
  resources: DocumentResources,
) {
  const text = container.text;

  if (text.length === 0) {
    return [
      {
        end: 0,
        height: lineHeight,
        start: 0,
        text: "",
        width: 0,
      },
    ];
  }

  if (requiresMeasuredInlineLayout(container)) {
    return createInlineMeasuredTextLines(cache, container, font, availableWidth, lineHeight, resources);
  }

  try {
    const prepared = prepareTextSegments(cache, text, font, resolveWhitespace(block));
    const layout = layoutWithLines(prepared, availableWidth, lineHeight);

    return layout.lines.map((line) => ({
      end: cursorToOffset(prepared.segments, line.end),
      height: lineHeight,
      start: cursorToOffset(prepared.segments, line.start),
      text: line.text,
      width: line.width,
    }));
  } catch {
    return createFallbackTextLines(text, availableWidth, lineHeight);
  }
}

function cursorToOffset(segments: string[], cursor: { graphemeIndex: number; segmentIndex: number }) {
  let offset = 0;

  for (let index = 0; index < cursor.segmentIndex; index += 1) {
    offset += segments[index]?.length ?? 0;
  }

  const segment = segments[cursor.segmentIndex] ?? "";
  const graphemes = Array.from(segment);

  for (let index = 0; index < cursor.graphemeIndex; index += 1) {
    offset += graphemes[index]?.length ?? 0;
  }

  return offset;
}

function createFallbackLineBoundaries(text: string) {
  const boundaries: TextLineBoundary[] = [
    {
      left: 0,
      offset: 0,
    },
  ];
  let left = 0;
  let offset = 0;

  for (const grapheme of Array.from(text)) {
    left += 9;
    offset += grapheme.length;
    boundaries.push({
      left,
      offset,
    });
  }

  return boundaries;
}

function createFallbackTextLines(text: string, availableWidth: number, lineHeight: number) {
  const lineWidth = Math.max(1, Math.floor(availableWidth / 9));
  const wrappedLines = wrapFallbackText(text, lineWidth);
  let localOffset = 0;

  return wrappedLines.map((lineText) => {
    const start = localOffset;
    const end = start + lineText.length;

    localOffset = end;

    return {
      end,
      height: lineHeight,
      start,
      text: lineText,
      width: lineText.length * 9,
    };
  });
}

function createInlineMeasuredTextLines(
  cache: CanvasRenderCache,
  container: DocumentEditorRegion,
  font: string,
  availableWidth: number,
  lineHeight: number,
  resources: DocumentResources,
) {
  const segments = flattenMeasuredInlineSegments(
    cache,
    getTextMeasurementContext(),
    container,
    font,
    availableWidth,
    lineHeight,
    resources,
  );

  if (segments.length === 0) {
    return [
      {
        end: 0,
        height: lineHeight,
        start: 0,
        text: "",
        width: 0,
      },
    ];
  }

  const lines: MeasuredTextLine[] = [];
  let index = 0;

  while (index < segments.length) {
    const lineStart = segments[index]!.start;

    if (segments[index]!.text === "\n") {
      lines.push({
        end: lineStart,
        height: lineHeight,
        start: lineStart,
        text: "",
        width: 0,
      });
      index += 1;
      continue;
    }

    let width = 0;
    let widthAtBreak = 0;
    let cursor = index;
    let breakIndex = -1;
    let maxHeight = lineHeight;

    while (cursor < segments.length) {
      const segment = segments[cursor]!;

      if (segment.text === "\n") {
        break;
      }

      const nextWidth = width + segment.width;

      if (nextWidth > availableWidth && cursor > index) {
        break;
      }

      width = nextWidth;
      maxHeight = Math.max(maxHeight, segment.height);

      if (segment.breakable) {
        breakIndex = cursor;
        widthAtBreak = width;
      }

      cursor += 1;
    }

    if (cursor === segments.length || segments[cursor]?.text === "\n") {
      const lineEnd = segments[cursor - 1]?.end ?? lineStart;

      lines.push({
        end: lineEnd,
        height: maxHeight,
        start: lineStart,
        text: container.text.slice(lineStart, lineEnd),
        width,
      });
      index = cursor < segments.length && segments[cursor]?.text === "\n" ? cursor + 1 : cursor;
      continue;
    }

    if (breakIndex >= index) {
      const lineEnd = segments[breakIndex]!.end;

      lines.push({
        end: lineEnd,
        height: maxHeight,
        start: lineStart,
        text: container.text.slice(lineStart, lineEnd),
        width: widthAtBreak,
      });
      index = breakIndex + 1;
      continue;
    }

    const lineEnd = segments[Math.max(index, cursor - 1)]!.end;

    lines.push({
      end: lineEnd,
      height: maxHeight,
      start: lineStart,
      text: container.text.slice(lineStart, lineEnd),
      width,
    });
    index = Math.max(index + 1, cursor);
  }

  return lines;
}

function flattenMeasuredInlineSegments(
  cache: CanvasRenderCache,
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null,
  container: DocumentEditorRegion,
  font: string,
  availableWidth: number,
  lineHeight: number,
  resources: DocumentResources,
) {
  const segments: MeasuredTextSegment[] = [];

  for (const run of container.runs) {
    if (run.kind === "image") {
      const dimensions = resolveInlineImageDimensions(run, resources, availableWidth);

      segments.push({
        breakable: true,
        end: run.end,
        height: dimensions.height,
        start: run.start,
        text: run.text,
        width: dimensions.width,
      });
      continue;
    }

    if (context) {
      context.font = resolveInlineFont(font, run.marks);
    }
    let offset = run.start;

    for (const grapheme of Array.from(run.text)) {
      const start = offset;
      const end = start + grapheme.length;

      segments.push({
        breakable: /\s/.test(grapheme),
        end,
        height: lineHeight,
        start,
        text: grapheme,
        width: grapheme === "\n" ? 0 : measureGraphemeWidth(cache, context, grapheme),
      });
      offset = end;
    }
  }

  return segments;
}

function requiresMeasuredInlineLayout(container: DocumentEditorRegion) {
  return container.runs.some((run) => run.kind === "image" || runHasInlineFontMetrics(run));
}

function resolveContainerMeasurementSignature(
  container: DocumentEditorRegion,
  resources: DocumentResources,
) {
  return container.runs
    .map((run) => `${run.start}-${run.end}:${resolveRunMeasurementSignature(run, resources)}`)
    .join("|");
}

function resolveRunMeasurementSignature(
  run: DocumentEditorTextRun,
  resources: DocumentResources,
) {
  if (run.kind === "image" && run.image) {
    return resolveInlineImageSignature(run, resources);
  }

  return `${run.kind}:${run.inlineCode ? 1 : 0}:${run.marks.join(",")}:${run.link?.url ?? ""}`;
}

function runHasInlineFontMetrics(run: DocumentEditorTextRun) {
  return run.marks.includes("italic") || run.marks.includes("bold");
}

function resolveInlineFont(font: string, marks: Mark[]) {
  const parts: string[] = [];

  if (marks.includes("italic")) {
    parts.push("italic");
  }

  if (marks.includes("bold")) {
    parts.push("700");
  }

  return parts.length > 0 ? `${parts.join(" ")} ${font}` : font;
}

function getTextMeasurementContext() {
  if (textMeasurementContext !== undefined) {
    return textMeasurementContext;
  }

  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(1, 1)
      : typeof document !== "undefined"
        ? document.createElement("canvas")
        : null;

  textMeasurementContext = canvas?.getContext("2d") ?? null;

  return textMeasurementContext;
}

function measureGraphemeWidth(
  cache: CanvasRenderCache,
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null,
  grapheme: string,
) {
  if (!context) {
    return 9;
  }

  const font = context.font;
  const fontCache = getOrCreateGraphemeWidthCache(cache, font);
  const cached = fontCache.get(grapheme);

  if (cached !== undefined) {
    return cached;
  }

  const width = context.measureText(grapheme).width;

  fontCache.set(grapheme, width);

  return width;
}

function resolveWhitespace(block: Block | null): NonNullable<PrepareOptions["whiteSpace"]> {
  return block?.type === "code" ? "pre-wrap" : "normal";
}

function wrapFallbackText(text: string, charactersPerLine: number) {
  if (text.length === 0) {
    return [""];
  }

  const explicitLines = text.split("\n");
  const wrapped: string[] = [];

  for (const explicitLine of explicitLines) {
    if (explicitLine.length === 0) {
      wrapped.push("");
      continue;
    }

    let remaining = explicitLine;

    while (remaining.length > charactersPerLine) {
      const slice = remaining.slice(0, charactersPerLine);
      const breakIndex = slice.lastIndexOf(" ");

      if (breakIndex <= 0) {
        wrapped.push(slice);
        remaining = remaining.slice(charactersPerLine);
        continue;
      }

      wrapped.push(slice.slice(0, breakIndex));
      remaining = remaining.slice(breakIndex + 1);
    }

    wrapped.push(remaining);
  }

  return wrapped;
}
