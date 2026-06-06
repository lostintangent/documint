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
import { isReferenceInlineNode, type Block, type Mark } from "@/document";
import type { DocumentResources } from "@/types";
import {
  findInlinesInRange,
  isSourceRegion,
  regionInlines,
  type IndexedInline,
  type EditableRegion,
} from "../../state";
import { splitGraphemes } from "../../text/graphemes";
import { resolveCodeFont, inlineTextHasCustomMetrics, resolveInlineTextStyle } from "../../text/fonts";
import {
  resolveInlineReferenceMeasurement,
  resolveInlineReferenceSignature,
  type InlineReferenceLayoutMetric,
} from "./inline-reference";
import {
  cacheLineBoundaries,
  cacheMeasuredLines,
  cachePreparedText,
  getOrCreateGraphemeWidthCache,
  type LayoutCache,
} from "../state/cache";

// Narrow helper reading text-style data from an `IndexedInline`.
function inlineMarks(run: IndexedInline): readonly Mark[] {
  return run.node.type === "text" ? run.node.marks : [];
}

function inlineIsCode(run: IndexedInline): boolean {
  return inlineMarks(run).includes("code");
}

export type TextLineBoundary = {
  left: number;
  offset: number;
};

export type TextInlineReference = InlineReferenceLayoutMetric;

type MeasuredTextLine = {
  end: number;
  height: number;
  inlineReferences: TextInlineReference[] | null;
  start: number;
  text: string;
  width: number;
};

type MeasuredTextSegment = {
  breakable: boolean;
  end: number;
  height: number;
  inlineReference: TextInlineReference | null;
  start: number;
  text: string;
  width: number;
};

type RichInlineMeasurementItem = {
  inlineReference: TextInlineReference | null;
  leadingTrimLength: number;
  run: IndexedInline;
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

// Heading typography expressed as ratios over the document base font size,
// so the whole hierarchy stays proportional at any base. At base 16 these
// reproduce the canonical 32/36 → 18/26 sizes; at base 14 they collapse to
// 28/32 → 16/23. `fontSizeRatio` scales the heading text; `lineHeightRatio`
// is independent because heading line spacing tightens slightly faster than
// font size grows (visual hierarchy reads cleaner that way).
const HEADING_TYPOGRAPHY = [
  { fontSizeRatio: 2.0, lineHeightRatio: 2.25 }, // H1
  { fontSizeRatio: 1.625, lineHeightRatio: 2.0 }, // H2
  { fontSizeRatio: 1.3125, lineHeightRatio: 1.75 }, // H3
  { fontSizeRatio: 1.3125, lineHeightRatio: 1.75 }, // H4
  { fontSizeRatio: 1.1875, lineHeightRatio: 1.625 }, // H5
  { fontSizeRatio: 1.125, lineHeightRatio: 1.625 }, // H6
] as const;

// Code block line height tracks the code font size (= baseFontSize - 1) at
// the same ratio the hand-tuned defaults used (22/15), so block code stays
// visually paired with inline code at any scale.
const CODE_BLOCK_LINE_HEIGHT_RATIO = 22 / 15;

const SANS_SERIF_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const exactPrefixBoundaryGraphemeLimit = 32;

let textMeasurementContext:
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D
  | undefined;

// One bundle for the three font-related values measurement helpers need for a
// given block: the block-resolved `font` (e.g. heading typography), the
// block-resolved `lineHeight`, and the document `baseFontSize` (which inline
// code derives from regardless of the surrounding block's font size).
// Resolving once at the boundary keeps the call sites quiet and the trio
// internally consistent.
export type BlockTypography = {
  baseFontSize: number;
  font: string;
  lineHeight: number;
};

export function resolveBlockTypography(
  block: Block | null,
  baseFontSize: number,
  fallbackLineHeight: number,
): BlockTypography {
  return {
    baseFontSize,
    font: resolveTextBlockFont(block, baseFontSize),
    lineHeight: resolveTextBlockLineHeight(block, fallbackLineHeight, baseFontSize),
  };
}

export function resolveTextBlockFont(block: Block | null, baseFontSize: number) {
  if (block?.type === "heading") {
    const { fontSize } = resolveHeadingTypography(block.depth, baseFontSize);

    return `700 ${fontSize}px ${SANS_SERIF_STACK}`;
  }

  switch (block?.type) {
    case "code":
      return resolveCodeFont(baseFontSize);
    default:
      return `${baseFontSize}px ${SANS_SERIF_STACK}`;
  }
}

export function resolveTextBlockLineHeight(
  block: Block | null,
  fallback: number,
  baseFontSize: number,
) {
  if (block?.type === "heading") {
    return resolveHeadingTypography(block.depth, baseFontSize).lineHeight;
  }

  if (block?.type === "code") {
    // Tracks the code font size at the same ratio the hand-tuned defaults
    // used (22 / 15) so block code stays visually paired with inline code at
    // any scale. Clamped to 1 to match `resolveCodeFont`'s floor — together
    // they keep the layout from collapsing at degenerate base font sizes.
    return Math.max(1, Math.round((baseFontSize - 1) * CODE_BLOCK_LINE_HEIGHT_RATIO));
  }

  return fallback;
}

function resolveHeadingTypography(depth: number, baseFontSize: number) {
  const { fontSizeRatio, lineHeightRatio } =
    HEADING_TYPOGRAPHY[depth - 1] ?? HEADING_TYPOGRAPHY.at(-1)!;

  return {
    fontSize: Math.round(baseFontSize * fontSizeRatio),
    lineHeight: Math.round(baseFontSize * lineHeightRatio),
  };
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
  container: EditableRegion,
  block: Block | null,
  availableWidth: number,
  typography: BlockTypography,
  resources: DocumentResources,
) {
  const cacheKey = `${resolveRegionMeasurementCacheIdentity(container, resources)}:${availableWidth}:${typography.lineHeight}:${typography.baseFontSize}:${typography.font}`;
  const cached = cache.measuredLines.get(cacheKey);

  if (cached) {
    return cached;
  }

  const measuredLines = createMeasuredTextLines(
    cache,
    container,
    block,
    availableWidth,
    typography,
    resources,
  );

  return cacheMeasuredLines(cache, cacheKey, measuredLines);
}

export function measureTextLineBoundaries(
  cache: LayoutCache,
  container: EditableRegion,
  start: number,
  end: number,
  text: string,
  availableWidth: number,
  typography: BlockTypography,
  resources: DocumentResources,
): TextLineBoundary[] {
  // Pretext returns line ranges and widths, but it does not currently expose
  // every editor offset's x-position. Keep this boundary projection local so
  // caret placement, hit testing, and decoration clipping share one cache.
  const cacheKey = `${resolveRegionMeasurementCacheIdentity(container, resources)}:${start}:${end}:${typography.baseFontSize}:${typography.font}:${availableWidth}`;
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

  if (isSourceRegion(container)) {
    let offset = 0;
    context.font = typography.font;

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

  const visibleRuns = findInlinesInRange(regionInlines(container), start, end);

  for (const run of visibleRuns) {
    const segmentStart = Math.max(start, run.start);
    const segmentEnd = Math.min(end, run.end);
    const segmentText = container.text.slice(segmentStart, segmentEnd);
    let offset = segmentStart - start;

    const reference = resolveInlineReferenceMeasurement(run, context, {
      availableWidth,
      typography,
      resources,
    });

    if (reference) {
      width += reference.width;
      offset += segmentText.length;
      boundaries.push({
        left: width,
        offset,
      });

      continue;
    }

    context.font = resolveInlineTextStyle(typography, inlineMarks(run)).font;

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
  container: EditableRegion,
  block: Block | null,
  availableWidth: number,
  typography: BlockTypography,
  resources: DocumentResources,
) {
  const text = container.text;
  const inlineProfile = resolveInlineMeasurementProfile(container);

  if (text.length === 0) {
    return [
      {
        end: 0,
        height: typography.lineHeight,
        inlineReferences: null,
        start: 0,
        text: "",
        width: 0,
      },
    ];
  }

  if (requiresLocalInlineLayout(inlineProfile)) {
    return createInlineMeasuredTextLines(cache, container, availableWidth, typography, resources);
  }

  if (inlineProfile.hasRichInline) {
    return createRichInlineMeasuredTextLines(container, availableWidth, typography, resources);
  }

  const prepared = prepareTextSegments(
    cache,
    text,
    typography.font,
    resolveWhitespace(block, inlineProfile),
  );
  const resolveOffset = createCursorOffsetResolver(prepared.segments);
  const lines: MeasuredTextLine[] = [];

  walkLineRanges(prepared, availableWidth, (line) => {
    const start = resolveOffset(line.start);
    const end = resolveMeasuredLineEnd(text, start, resolveOffset(line.end));

    lines.push({
      end,
      height: typography.lineHeight,
      inlineReferences: null,
      start,
      text: text.slice(start, end),
      width: line.width,
    });
  });

  if (inlineProfile.hasHardBreak && text.endsWith("\n")) {
    lines.push({
      end: text.length,
      height: typography.lineHeight,
      inlineReferences: null,
      start: text.length,
      text: "",
      width: 0,
    });
  }

  // Pretext preserves `pre-wrap` hard breaks, but does not emit the empty
  // visual row after a trailing source newline. Materialize it so code-block
  // carets can land immediately after pressing Enter at end-of-source.
  return isSourceRegion(container) && text.endsWith("\n")
    ? materializeTrailingSourceTextLine(lines, text.length, typography.lineHeight)
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
      inlineReferences: null,
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
  container: EditableRegion,
  availableWidth: number,
  typography: BlockTypography,
  resources: DocumentResources,
) {
  const segments = flattenMeasuredInlineSegments(
    cache,
    getTextMeasurementContext(),
    container,
    availableWidth,
    typography,
    resources,
  );

  if (segments.length === 0) {
    return [
      {
        end: 0,
        height: typography.lineHeight,
        inlineReferences: null,
        start: 0,
        text: "",
        width: 0,
      },
    ];
  }

  return layoutSegmentsIntoLines(segments, container.text, availableWidth, typography.lineHeight);
}

function createRichInlineMeasuredTextLines(
  container: EditableRegion,
  availableWidth: number,
  typography: BlockTypography,
  resources: DocumentResources,
) {
  const { items, measurementItems } = createRichInlineMeasurementItems(
    container,
    availableWidth,
    typography,
    resources,
  );

  if (items.length === 0) {
    return [
      {
        end: 0,
        height: typography.lineHeight,
        inlineReferences: null,
        start: 0,
        text: "",
        width: 0,
      },
    ];
  }

  const prepared = prepareRichInline(items);
  const internalPrepared = prepared as InternalPreparedRichInline;
  const inlineReferences = resolveInlineReferencesFromMeasurementItems(measurementItems);
  const lines: MeasuredTextLine[] = [];

  walkRichInlineLineRanges(prepared, availableWidth, (line) => {
    const range = resolveRichInlineSourceRange(internalPrepared, measurementItems, line.fragments);

    if (!range) {
      return;
    }

    lines.push({
      end: range.end,
      height: typography.lineHeight,
      inlineReferences: resolveLineInlineReferences(inlineReferences, range.start, range.end),
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
          height: typography.lineHeight,
          inlineReferences: null,
          start: 0,
          text: "",
          width: 0,
        },
      ];
}

function resolveInlineReferencesFromMeasurementItems(
  measurementItems: RichInlineMeasurementItem[],
) {
  const references: TextInlineReference[] = [];

  for (const item of measurementItems) {
    if (item.inlineReference) {
      references.push(item.inlineReference);
    }
  }

  return references;
}

function createRichInlineMeasurementItems(
  container: EditableRegion,
  availableWidth: number,
  typography: BlockTypography,
  resources: DocumentResources,
) {
  const items: RichInlineItem[] = [];
  const measurementItems: RichInlineMeasurementItem[] = [];
  const context = getTextMeasurementContext();

  for (const run of regionInlines(container)) {
    const runText = container.text.slice(run.start, run.end);
    const reference = resolveInlineReferenceMeasurement(run, context, {
      availableWidth,
      typography,
      resources,
    });

    if (reference?.richItem) {
      items.push(reference.richItem);
      measurementItems.push({
        inlineReference: reference.inlineReference,
        leadingTrimLength: 0,
        run,
      });
      continue;
    }

    items.push({
      font: resolveInlineTextStyle(typography, inlineMarks(run)).font,
      text: runText,
    });
    measurementItems.push({
      inlineReference: null,
      leadingTrimLength: resolveLeadingCollapsibleLength(runText),
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

  if (run.node.type === "mention" || run.node.type === "resource") {
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
        inlineReferences: null,
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
        inlineReferences: resolveSegmentInlineReferences(segments, index, cursor),
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
        inlineReferences: resolveSegmentInlineReferences(segments, index, breakIndex + 1),
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
      inlineReferences: resolveSegmentInlineReferences(segments, index, Math.max(index + 1, cursor)),
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
      inlineReferences: null,
      start: lastSegment.end,
      text: "",
      width: 0,
    });
  }

  return lines;
}

function resolveSegmentInlineReferences(
  segments: MeasuredTextSegment[],
  startIndex: number,
  endIndex: number,
) {
  const references: TextInlineReference[] = [];

  for (let index = startIndex; index < endIndex; index += 1) {
    const reference = segments[index]?.inlineReference;

    if (reference) {
      references.push(reference);
    }
  }

  return references.length > 0 ? references : null;
}

function resolveLineInlineReferences(
  references: TextInlineReference[],
  startOffset: number,
  endOffset: number,
) {
  const lineReferences = references.filter(
    (reference) => reference.end > startOffset && reference.start < endOffset,
  );

  return lineReferences.length > 0 ? lineReferences : null;
}

function flattenMeasuredInlineSegments(
  cache: LayoutCache,
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  container: EditableRegion,
  availableWidth: number,
  typography: BlockTypography,
  resources: DocumentResources,
) {
  const segments: MeasuredTextSegment[] = [];

  for (const run of regionInlines(container)) {
    const runText = container.text.slice(run.start, run.end);
    const reference = resolveInlineReferenceMeasurement(run, context, {
      availableWidth,
      typography,
      resources,
    });

    if (reference) {
      segments.push({
        breakable: true,
        end: run.end,
        height: reference.height,
        inlineReference: reference.inlineReference,
        start: run.start,
        text: reference.text,
        width: reference.width,
      });
      continue;
    }

    context.font = resolveInlineTextStyle(typography, inlineMarks(run)).font;

    let offset = run.start;

    for (const grapheme of splitBoundaryUnits(runText)) {
      const start = offset;
      const end = start + grapheme.length;

      segments.push({
        breakable: /\s/.test(grapheme),
        end,
        height: typography.lineHeight,
        inlineReference: null,
        start,
        text: grapheme,
        width: grapheme === "\n" ? 0 : measureGraphemeWidth(cache, context, grapheme),
      });
      offset = end;
    }
  }

  return segments;
}

function resolveInlineMeasurementProfile(container: EditableRegion): InlineMeasurementProfile {
  let hasHardBreak = false;
  let hasImage = false;
  let hasRichInline = false;

  for (const run of regionInlines(container)) {
    if (run.node.type === "image") {
      hasImage = true;
    } else if (run.node.type === "lineBreak") {
      hasHardBreak = true;
    }

    if (isReferenceInlineNode(run.node) || runHasInlineCustomMetrics(run)) {
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
// Image/resource regions are skipped because their identity also depends on
// mutable `resources` state (image load/intrinsic dimensions, resource protocol
// labels/icons); cheap to recompute.
const regionIdentityByInlines = new WeakMap<
  readonly IndexedInline[],
  { identity: string; path: string; text: string }
>();

export function resolveRegionMeasurementCacheIdentity(
  container: EditableRegion,
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

  const { hasResourceDependency, signature } = resolveContainerMeasurementSignature(
    container,
    resources,
  );
  const identity = [container.path, hashMeasurementText(container.text), signature].join(":");

  if (!hasResourceDependency) {
    regionIdentityByInlines.set(inlines, {
      identity,
      path: container.path,
      text: container.text,
    });
  }

  return identity;
}

function resolveContainerMeasurementSignature(
  container: EditableRegion,
  resources: DocumentResources,
) {
  let hasResourceDependency = false;
  let signature = "";

  for (const run of regionInlines(container)) {
    if (signature) {
      signature += "|";
    }

    const reference = resolveInlineReferenceSignature(run, resources);

    hasResourceDependency ||= reference?.hasMutableResourceDependency ?? false;
    signature += `${run.start}-${run.end}:${
      reference?.signature ?? resolveRunMeasurementSignature(run)
    }`;
  }

  return { hasResourceDependency, signature };
}

function resolveRunMeasurementSignature(run: IndexedInline) {
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

function runHasInlineCustomMetrics(run: IndexedInline) {
  return inlineTextHasCustomMetrics(inlineMarks(run));
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
