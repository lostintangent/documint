// Owns text measurement for render layout. Pretext handles the normal text
// wrapping paths; this module adapts Pretext cursors back to editor UTF-16
// offsets, materializes caret/hit-test boundaries, and keeps the narrow local
// fallback for inline images and unsupported rich hard breaks.

import { prepareWithSegments, walkLineRanges, type PrepareOptions } from "@chenglou/pretext";
import {
  prepareRichInline,
  walkRichInlineLineRanges,
  type PreparedRichInline,
  type RichInlineFragmentRange,
  type RichInlineItem,
} from "@chenglou/pretext/rich-inline";
import type { Block, Image, Mark, Mention } from "@/document";
import type { DocumentResources } from "@/types";
import {
  findInlinesInSpan,
  isSourceTextRegion,
  regionInlines,
  type InlineEntry,
  type RegionEntry,
} from "../../state";
import { splitGraphemes } from "../../text/graphemes";
import { codeTextFont, inlineTextHasCustomMetrics, resolveInlineTextStyle } from "../../text/fonts";
import { resolveInlineImageDimensions, resolveInlineImageSignature } from "./inline-image";
import { measureInlineMentionWidth, mentionHorizontalPadding } from "./inline-mention";
import {
  cacheLineBoundaries,
  cacheMeasuredLines,
  cachePreparedText,
  getOrCreateGraphemeWidthCache,
  type LayoutCache,
} from "../state/cache";

// Narrow helpers reading kind-specific data from an `InlineEntry`. The
// discriminator is `inline.node.type` (the document's `Inline` union). Marks
// only exist on text nodes; inline-code is the kind itself; mention/image
// type-guards narrow `inline.node` for downstream attribute access.
function inlineMarks(run: InlineEntry): readonly Mark[] {
  return run.node.type === "text" ? run.node.marks : [];
}

function inlineIsCode(run: InlineEntry): boolean {
  return run.node.type === "code";
}

function isMentionInline(run: InlineEntry): run is InlineEntry & { node: Mention } {
  return run.node.type === "mention";
}

function isImageInline(run: InlineEntry): run is InlineEntry & { node: Image } {
  return run.node.type === "image";
}

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

type RichInlineMeasurementItem = {
  leadingTrimLength: number;
  run: InlineEntry;
};

type InlineMeasurementProfile = {
  hasHardBreak: boolean;
  hasImage: boolean;
  hasRichInline: boolean;
};

type TextCursor = { graphemeIndex: number; segmentIndex: number };

// Pretext does not currently expose source-offset mapping for rich-inline
// fragments, so this intentionally reads the prepared item table that backs
// `RichInlineFragmentRange.itemIndex`. Keep this adapter narrow.
type InternalPreparedRichInline = PreparedRichInline & {
  itemsBySourceItemIndex: Array<
    | {
        prepared: ReturnType<typeof prepareWithSegments>;
      }
    | undefined
  >;
};

const headingTypographyScale = [
  { fontSize: 32, lineHeight: 36 },
  { fontSize: 26, lineHeight: 32 },
  { fontSize: 21, lineHeight: 28 },
  { fontSize: 21, lineHeight: 28 },
  { fontSize: 19, lineHeight: 26 },
  { fontSize: 18, lineHeight: 26 },
] as const;

const SANS_SERIF_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const exactPrefixBoundaryGraphemeLimit = 32;

let textMeasurementContext:
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D
  | undefined;

export function resolveTextBlockFont(block: Block | null) {
  if (block?.type === "heading") {
    const { fontSize } = resolveHeadingTypography(block.depth);

    return `700 ${fontSize}px ${SANS_SERIF_STACK}`;
  }

  switch (block?.type) {
    case "code":
      return codeTextFont;
    default:
      return `16px ${SANS_SERIF_STACK}`;
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

// Pretext handles grapheme-aware wrapping internally. This helper is only for
// editor offset projection and local boundary materialization.
function splitBoundaryUnits(text: string) {
  return isAsciiText(text) ? text.split("") : splitGraphemes(text);
}

function isAsciiText(text: string) {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 0x7f) {
      return false;
    }
  }

  return true;
}

export function measureTextContainerLines(
  cache: LayoutCache,
  container: RegionEntry,
  font: string,
  block: Block | null,
  availableWidth: number,
  lineHeight: number,
  resources: DocumentResources,
) {
  const cacheKey = `${resolveRegionMeasurementCacheIdentity(container, resources)}:${availableWidth}:${lineHeight}:${font}`;
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
  cache: LayoutCache,
  container: RegionEntry,
  start: number,
  end: number,
  text: string,
  font: string,
  availableWidth: number,
  resources: DocumentResources,
): TextLineBoundary[] {
  // Pretext returns line ranges and widths, but it does not currently expose
  // every editor offset's x-position. Keep this boundary projection local so
  // caret placement, hit testing, and decoration clipping share one cache.
  const cacheKey = `${resolveRegionMeasurementCacheIdentity(container, resources)}:${start}:${end}:${font}:${availableWidth}`;
  const cached = cache.lineBoundaries.get(cacheKey);

  if (cached) {
    return cached;
  }

  const context = getTextMeasurementContext();

  const boundaries: TextLineBoundary[] = [
    {
      left: 0,
      offset: 0,
    },
  ];
  let width = 0;

  if (isSourceTextRegion(container)) {
    let offset = 0;
    context.font = font;

    for (const advance of measureTextBoundaryAdvances(cache, context, text)) {
      width += advance.width;
      offset += advance.length;
      boundaries.push({
        left: width,
        offset,
      });
    }

    return cacheLineBoundaries(cache, cacheKey, boundaries);
  }

  const visibleRuns = findInlinesInSpan(regionInlines(container), start, end);

  for (const run of visibleRuns) {
    const segmentStart = Math.max(start, run.start);
    const segmentEnd = Math.min(end, run.end);
    const segmentText = container.text.slice(segmentStart, segmentEnd);
    let offset = segmentStart - start;

    if (run.node.type === "image") {
      const imageWidth = resolveInlineImageDimensions(run, resources, availableWidth).width;
      width += imageWidth;
      offset += segmentText.length;
      boundaries.push({
        left: width,
        offset,
      });

      continue;
    }

    context.font = resolveInlineTextStyle(font, inlineMarks(run), inlineIsCode(run)).font;

    if (isMentionInline(run)) {
      width += measureInlineMentionWidth(context, run.node);
      offset += segmentText.length;
      boundaries.push({
        left: width,
        offset,
      });

      continue;
    }

    for (const advance of measureTextBoundaryAdvances(cache, context, segmentText)) {
      width += advance.width;
      offset += advance.length;
      boundaries.push({
        left: width,
        offset,
      });
    }
  }

  return cacheLineBoundaries(cache, cacheKey, boundaries);
}

function prepareTextSegments(
  cache: LayoutCache,
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
  cache: LayoutCache,
  container: RegionEntry,
  font: string,
  block: Block | null,
  availableWidth: number,
  lineHeight: number,
  resources: DocumentResources,
) {
  const text = container.text;
  const inlineProfile = resolveInlineMeasurementProfile(container);

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

  if (requiresLocalInlineLayout(inlineProfile)) {
    return createInlineMeasuredTextLines(
      cache,
      container,
      font,
      availableWidth,
      lineHeight,
      resources,
    );
  }

  if (inlineProfile.hasRichInline) {
    return createRichInlineMeasuredTextLines(container, font, availableWidth, lineHeight);
  }

  const prepared = prepareTextSegments(cache, text, font, resolveWhitespace(block, inlineProfile));
  const resolveOffset = createCursorOffsetResolver(prepared.segments);
  const lines: MeasuredTextLine[] = [];

  walkLineRanges(prepared, availableWidth, (line) => {
    const start = resolveOffset(line.start);
    const end = resolveMeasuredLineEnd(text, start, resolveOffset(line.end));

    lines.push({
      end,
      height: lineHeight,
      start,
      text: text.slice(start, end),
      width: line.width,
    });
  });

  if (inlineProfile.hasHardBreak && text.endsWith("\n")) {
    lines.push({
      end: text.length,
      height: lineHeight,
      start: text.length,
      text: "",
      width: 0,
    });
  }

  // Pretext preserves `pre-wrap` hard breaks, but does not emit the empty
  // visual row after a trailing source newline. Materialize it so code-block
  // carets can land immediately after pressing Enter at end-of-source.
  return isSourceTextRegion(container) && text.endsWith("\n")
    ? materializeTrailingSourceTextLine(lines, text.length, lineHeight)
    : lines;
}

function materializeTrailingSourceTextLine(
  lines: MeasuredTextLine[],
  offset: number,
  lineHeight: number,
): MeasuredTextLine[] {
  if (lines.some((line) => line.start === offset && line.end === offset)) {
    return lines;
  }

  return [
    ...lines,
    {
      end: offset,
      height: lineHeight,
      start: offset,
      text: "",
      width: 0,
    },
  ];
}

function resolveMeasuredLineEnd(text: string, start: number, end: number) {
  return end > start && text[end - 1] === "\n" ? end - 1 : end;
}

// Local line layout is intentionally limited to cases Pretext does not model:
// images are replaced elements whose width and height come from document
// resources, while `rich-inline` currently only accepts text items plus
// horizontal `extraWidth`; and rich inline content mixed with hard breaks needs
// `pre-wrap` semantics, while `rich-inline` is a `white-space: normal` helper.
function createInlineMeasuredTextLines(
  cache: LayoutCache,
  container: RegionEntry,
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

  return layoutSegmentsIntoLines(segments, container.text, availableWidth, lineHeight);
}

function createRichInlineMeasuredTextLines(
  container: RegionEntry,
  font: string,
  availableWidth: number,
  lineHeight: number,
) {
  const { items, measurementItems } = createRichInlineMeasurementItems(container, font);

  if (items.length === 0) {
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

  const prepared = prepareRichInline(items);
  const internalPrepared = prepared as InternalPreparedRichInline;
  const lines: MeasuredTextLine[] = [];

  walkRichInlineLineRanges(prepared, availableWidth, (line) => {
    const range = resolveRichInlineSourceRange(internalPrepared, measurementItems, line.fragments);

    if (!range) {
      return;
    }

    lines.push({
      end: range.end,
      height: lineHeight,
      start: range.start,
      text: container.text.slice(range.start, range.end),
      width: line.width,
    });
  });

  return lines.length > 0
    ? lines
    : [
        {
          end: 0,
          height: lineHeight,
          start: 0,
          text: "",
          width: 0,
        },
      ];
}

function createRichInlineMeasurementItems(container: RegionEntry, font: string) {
  const items: RichInlineItem[] = [];
  const measurementItems: RichInlineMeasurementItem[] = [];

  for (const run of regionInlines(container)) {
    if (run.node.type === "mention") {
      items.push({
        break: "never",
        extraWidth: mentionHorizontalPadding * 2,
        font: resolveInlineTextStyle(font, inlineMarks(run), inlineIsCode(run)).font,
        text: `@${run.node.name}`,
      });
      measurementItems.push({
        leadingTrimLength: 0,
        run,
      });
      continue;
    }

    items.push({
      font: resolveInlineTextStyle(font, inlineMarks(run), inlineIsCode(run)).font,
      text: run.text,
    });
    measurementItems.push({
      leadingTrimLength: resolveLeadingCollapsibleLength(run.text),
      run,
    });
  }

  return {
    items,
    measurementItems,
  };
}

function resolveRichInlineSourceRange(
  prepared: InternalPreparedRichInline,
  measurementItems: RichInlineMeasurementItem[],
  fragments: RichInlineFragmentRange[],
) {
  let start: number | null = null;
  let end: number | null = null;

  for (const fragment of fragments) {
    const fragmentStart = resolveRichInlineFragmentOffset(
      prepared,
      measurementItems,
      fragment,
      "start",
    );
    const fragmentEnd = resolveRichInlineFragmentOffset(
      prepared,
      measurementItems,
      fragment,
      "end",
    );

    if (fragmentStart === null || fragmentEnd === null) {
      continue;
    }

    start = start === null ? fragmentStart : Math.min(start, fragmentStart);
    end = end === null ? fragmentEnd : Math.max(end, fragmentEnd);
  }

  return start === null || end === null
    ? null
    : {
        end,
        start,
      };
}

function resolveRichInlineFragmentOffset(
  prepared: InternalPreparedRichInline,
  measurementItems: RichInlineMeasurementItem[],
  fragment: RichInlineFragmentRange,
  side: "end" | "start",
) {
  const measurementItem = measurementItems[fragment.itemIndex];
  const preparedItem = prepared.itemsBySourceItemIndex[fragment.itemIndex];

  if (!measurementItem || !preparedItem) {
    return null;
  }

  const { run } = measurementItem;

  if (run.node.type === "mention") {
    return side === "start" ? run.start : run.end;
  }

  const cursor = side === "start" ? fragment.start : fragment.end;

  return (
    run.start +
    measurementItem.leadingTrimLength +
    createCursorOffsetResolver(preparedItem.prepared.segments)(cursor)
  );
}

function createCursorOffsetResolver(segments: string[]) {
  const segmentOffsets: number[] = [];
  const graphemeOffsetsBySegment = new Map<number, number[]>();
  let offset = 0;

  for (const segment of segments) {
    segmentOffsets.push(offset);
    offset += segment.length;
  }

  return (cursor: TextCursor) => {
    const segmentOffset = segmentOffsets[cursor.segmentIndex] ?? offset;

    if (cursor.graphemeIndex === 0) {
      return segmentOffset;
    }

    let graphemeOffsets = graphemeOffsetsBySegment.get(cursor.segmentIndex);

    if (!graphemeOffsets) {
      graphemeOffsets = createGraphemeOffsets(segments[cursor.segmentIndex] ?? "");
      graphemeOffsetsBySegment.set(cursor.segmentIndex, graphemeOffsets);
    }

    return segmentOffset + (graphemeOffsets[cursor.graphemeIndex] ?? 0);
  };
}

function createGraphemeOffsets(segment: string) {
  const offsets = [0];
  let offset = 0;

  for (const grapheme of splitBoundaryUnits(segment)) {
    offset += grapheme.length;
    offsets.push(offset);
  }

  return offsets;
}

function resolveLeadingCollapsibleLength(text: string) {
  return text.match(/^[ \t\n\f\r]+/)?.[0].length ?? 0;
}

// Greedy line-breaking over pre-measured inline segments. Consumes segments
// left-to-right, accumulating width until the line overflows or hits an
// explicit newline, then emits the line at the best available break point.
function layoutSegmentsIntoLines(
  segments: MeasuredTextSegment[],
  text: string,
  availableWidth: number,
  lineHeight: number,
) {
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
        text: text.slice(lineStart, lineEnd),
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
        text: text.slice(lineStart, lineEnd),
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
      text: text.slice(lineStart, lineEnd),
      width,
    });
    index = Math.max(index + 1, cursor);
  }

  // If the region ends on a `\n`, the loop consumes it as a separator but
  // never materializes the empty line on the other side. Emit it explicitly
  // so the caret has somewhere to land after a soft break at end-of-region.
  // Mirrors the empty-region path at the top of `createMeasuredTextLines`,
  // which materializes one empty line for a region with no content at all.
  const lastSegment = segments.at(-1);
  if (lastSegment?.text === "\n") {
    lines.push({
      end: lastSegment.end,
      height: lineHeight,
      start: lastSegment.end,
      text: "",
      width: 0,
    });
  }

  return lines;
}

function flattenMeasuredInlineSegments(
  cache: LayoutCache,
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  container: RegionEntry,
  font: string,
  availableWidth: number,
  lineHeight: number,
  resources: DocumentResources,
) {
  const segments: MeasuredTextSegment[] = [];

  for (const run of regionInlines(container)) {
    if (run.node.type === "image") {
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

    context.font = resolveInlineTextStyle(font, inlineMarks(run), inlineIsCode(run)).font;

    if (isMentionInline(run)) {
      segments.push({
        breakable: true,
        end: run.end,
        height: lineHeight,
        start: run.start,
        text: run.text,
        width: measureInlineMentionWidth(context, run.node),
      });
      continue;
    }

    let offset = run.start;

    for (const grapheme of splitBoundaryUnits(run.text)) {
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

function resolveInlineMeasurementProfile(container: RegionEntry): InlineMeasurementProfile {
  let hasHardBreak = false;
  let hasImage = false;
  let hasRichInline = false;

  for (const run of regionInlines(container)) {
    if (run.node.type === "image") {
      hasImage = true;
    } else if (run.node.type === "lineBreak") {
      hasHardBreak = true;
    }

    if (isMentionInline(run) || runHasInlineCustomMetrics(run)) {
      hasRichInline = true;
    }
  }

  return {
    hasHardBreak,
    hasImage,
    hasRichInline,
  };
}

function requiresLocalInlineLayout(profile: InlineMeasurementProfile) {
  // Inline images affect line height, which Pretext's inline helpers do not
  // own. Rich inline content with hard breaks also stays local because
  // `rich-inline` is intentionally normal-whitespace-only.
  return profile.hasImage || (profile.hasHardBreak && profile.hasRichInline);
}

// Memoizes the per-region cache identity by the region's `inlines` array
// reference. The inlines array survives `{...region, start, end}` shifts done
// by the indexer during typing, so unchanged regions hit this cache on every
// keystroke instead of re-hashing their text and re-serializing every inline.
//
// Image regions are skipped because their identity also depends on mutable
// `resources` state (load status, intrinsic dimensions); cheap to recompute.
const regionIdentityByInlines = new WeakMap<
  readonly InlineEntry[],
  { identity: string; path: string; text: string }
>();

export function resolveRegionMeasurementCacheIdentity(
  container: RegionEntry,
  resources: DocumentResources,
) {
  const inlines = regionInlines(container);
  const cached = regionIdentityByInlines.get(inlines);

  // Path and text are validated as defense-in-depth. In current code, an
  // `inlines` array reference is only reachable from a region whose path and
  // text are also unchanged (the indexer's `{...region, start, end}` shift
  // preserves all three by reference; any content edit allocates a fresh
  // inlines array). The extra checks are essentially free and protect the
  // cache against any future code path that decouples them.
  if (cached && cached.path === container.path && cached.text === container.text) {
    return cached.identity;
  }

  const identity = [
    container.path,
    hashMeasurementText(container.text),
    resolveContainerMeasurementSignature(container, resources),
  ].join(":");

  if (!inlines.some((run) => run.node.type === "image")) {
    regionIdentityByInlines.set(inlines, {
      identity,
      path: container.path,
      text: container.text,
    });
  }

  return identity;
}

function resolveContainerMeasurementSignature(
  container: RegionEntry,
  resources: DocumentResources,
) {
  return regionInlines(container)
    .map((run) => `${run.start}-${run.end}:${resolveRunMeasurementSignature(run, resources)}`)
    .join("|");
}

function resolveRunMeasurementSignature(run: InlineEntry, resources: DocumentResources) {
  if (isImageInline(run)) {
    return resolveInlineImageSignature(run, resources);
  }

  if (isMentionInline(run)) {
    return `mention:${run.node.userId}:${run.node.name}`;
  }

  return `${run.node.type}:${inlineIsCode(run) ? 1 : 0}:${inlineMarks(run).join(",")}:${run.link?.url ?? ""}`;
}

function hashMeasurementText(text: string) {
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function runHasInlineCustomMetrics(run: InlineEntry) {
  return inlineTextHasCustomMetrics(inlineMarks(run), inlineIsCode(run));
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

  const context = canvas?.getContext("2d");

  if (!context) {
    throw new Error("Text measurement requires OffscreenCanvas or a DOM canvas context.");
  }

  textMeasurementContext = context;

  return context;
}

function measureGraphemeWidth(
  cache: LayoutCache,
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  grapheme: string,
) {
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

function measureTextBoundaryAdvances(
  cache: LayoutCache,
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  text: string,
) {
  const graphemes = splitBoundaryUnits(text);

  if (graphemes.length <= exactPrefixBoundaryGraphemeLimit) {
    const advances: Array<{ length: number; width: number }> = [];
    let prefixOffset = 0;
    let previousWidth = 0;

    for (const grapheme of graphemes) {
      prefixOffset += grapheme.length;

      const nextWidth = measureTextPrefixWidth(context, text, prefixOffset);

      advances.push({
        length: grapheme.length,
        width: nextWidth - previousWidth,
      });
      previousWidth = nextWidth;
    }

    return advances;
  }

  const advances: Array<{ length: number; width: number }> = [];
  let previousGrapheme: string | null = null;
  let previousWidth = 0;

  for (const grapheme of graphemes) {
    const currentWidth = measureGraphemeWidth(cache, context, grapheme);

    advances.push({
      length: grapheme.length,
      width:
        previousGrapheme === null
          ? currentWidth
          : measureGraphemeWidth(cache, context, previousGrapheme + grapheme) - previousWidth,
    });

    previousGrapheme = grapheme;
    previousWidth = currentWidth;
  }

  return advances;
}

function measureTextPrefixWidth(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  text: string,
  offset: number,
) {
  return context.measureText(text.slice(0, offset)).width;
}

function resolveWhitespace(
  block: Block | null,
  profile: InlineMeasurementProfile,
): NonNullable<PrepareOptions["whiteSpace"]> {
  return block?.type === "code" || profile.hasHardBreak ? "pre-wrap" : "normal";
}
