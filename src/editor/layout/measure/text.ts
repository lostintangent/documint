// Owns text measurement for render layout. Pretext wraps every line, plain
// text through `prepareWithSegments` and rich paragraphs through
// `rich-inline`; this module adapts Pretext's results back to editor UTF-16
// offsets and materializes positioned layout lines with caret/hit-test
// boundaries.

import {
  prepareWithSegments,
  walkLineRanges,
  type LayoutCursor,
  type PrepareOptions,
} from "@chenglou/pretext";
import {
  materializeRichInlineLineRange,
  prepareRichInline,
  walkRichInlineLineRanges,
  type PreparedRichInline,
  type RichInlineBox,
  type RichInlineItem,
  type RichInlineLineRange,
} from "@chenglou/pretext/rich-inline";
import { isReferenceInlineNode, type Block } from "@/document";
import type { DocumentResources } from "@/editor/resources";
import { findInlinesInRange, inlineMarks, type IndexedInline } from "../../state";
import { splitGraphemes } from "../../text/graphemes";
import {
  resolveCodeFont,
  inlineTextHasCustomMetrics,
  resolvePlainTextFont,
  resolveStrongTextFont,
  resolveInlineTextStyle,
} from "../../text/fonts";
import {
  resolveInlineReferenceMeasurement,
  resolveInlineReferenceSignature,
  type LayoutInlineReference,
} from "./inline-reference";
import {
  cacheLineBoundaries,
  cacheMeasuredLines,
  cachePreparedText,
  getOrCreateGraphemeWidthCache,
  type LayoutCache,
} from "../state/cache";
import type { LayoutLine } from "./index";

function inlineIsCode(run: IndexedInline): boolean {
  return inlineMarks(run).includes("code");
}

export type LineBoundary = {
  left: number;
  offset: number;
};

export type LayoutTextInput = {
  path: string;
  text: string;
} & (
  | {
      inlines: readonly IndexedInline[];
      kind: "inlines";
    }
  | { kind: "plain" | "preformatted" }
);

export type MeasuredTextLine = {
  end: number;
  height: number;
  inlineReferences: LayoutInlineReference[] | null;
  start: number;
  text: string;
  width: number;
};

type TextLinePlacement = {
  blockPath: string | null;
  contentInset: number;
  left: number;
  top: number;
};

type RichInlineMeasurementItem = {
  height: number;
  inlineReference: LayoutInlineReference | null;
  run: IndexedInline;
};

type InlineMeasurementProfile = {
  hasHardBreak: boolean;
  hasRichInline: boolean;
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

    return resolveStrongTextFont(fontSize);
  }

  switch (block?.type) {
    case "code":
      return resolveCodeFont(baseFontSize);
    default:
      return resolvePlainTextFont(baseFontSize);
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

// Measures a text container, then positions its lines top-down from
// `placement.top` with their caret/hit-test boundaries. Body blocks, table
// cells, and metadata cells all emit `LayoutLine`s through here.
export function layoutTextContainerLines(
  cache: LayoutCache,
  container: LayoutTextInput,
  availableWidth: number,
  typography: BlockTypography,
  resources: DocumentResources,
  placement: TextLinePlacement,
): LayoutLine[] {
  const measuredLines = measureTextContainerLines(
    cache,
    container,
    availableWidth,
    typography,
    resources,
  );
  const lines: LayoutLine[] = [];
  let top = placement.top;

  for (const line of measuredLines) {
    lines.push({
      blockPath: placement.blockPath,
      boundaries: measureTextLineBoundaries(
        cache,
        container,
        line.start,
        line.end,
        line.text,
        availableWidth,
        typography,
        resources,
      ),
      contentInset: placement.contentInset,
      end: line.end,
      font: typography.font,
      height: line.height,
      inlineReferences: line.inlineReferences,
      left: placement.left,
      path: container.path,
      start: line.start,
      text: line.text,
      top,
      width: line.width,
    });
    top += line.height;
  }

  return lines;
}

export function sumLineHeights(lines: readonly { height: number }[]) {
  return lines.reduce((total, line) => total + line.height, 0);
}

export function measureTextContainerLines(
  cache: LayoutCache,
  container: LayoutTextInput,
  availableWidth: number,
  typography: BlockTypography,
  resources: DocumentResources,
) {
  const cacheKey = `${resolveTextMeasurementCacheIdentity(container, resources)}:${availableWidth}:${typography.lineHeight}:${typography.baseFontSize}:${typography.font}`;
  const cached = cache.measuredLines.get(cacheKey);

  if (cached) {
    return cached;
  }

  const measuredLines = createMeasuredTextLines(
    cache,
    container,
    availableWidth,
    typography,
    resources,
  );

  return cacheMeasuredLines(cache, cacheKey, measuredLines);
}

function measureTextLineBoundaries(
  cache: LayoutCache,
  container: LayoutTextInput,
  start: number,
  end: number,
  text: string,
  availableWidth: number,
  typography: BlockTypography,
  resources: DocumentResources,
): LineBoundary[] {
  // Pretext returns line ranges and widths, but it does not currently expose
  // every editor offset's x-position. Keep this boundary projection local so
  // caret placement, hit testing, and decoration clipping share one cache.
  const cacheKey = `${resolveTextMeasurementCacheIdentity(container, resources)}:${start}:${end}:${typography.baseFontSize}:${typography.font}:${availableWidth}`;
  const cached = cache.lineBoundaries.get(cacheKey);

  if (cached) {
    return cached;
  }

  const context = getTextMeasurementContext();

  const boundaries: LineBoundary[] = [
    {
      left: 0,
      offset: 0,
    },
  ];
  let width = 0;

  if (isPlainTextContainer(container)) {
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

  const visibleRuns = findInlinesInRange(containerInlines(container), start, end);

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
  container: LayoutTextInput,
  availableWidth: number,
  typography: BlockTypography,
  resources: DocumentResources,
) {
  const text = container.text;
  const inlineProfile = resolveInlineMeasurementProfile(container);

  if (text.length === 0) {
    return [emptyMeasuredLine(0, typography.lineHeight)];
  }

  const whiteSpace = resolveWhitespace(container, inlineProfile);
  const measuredText = whiteSpace === "normal" ? pinCollapsibleWhitespace(text) : text;
  const lines =
    container.kind === "inlines" && inlineProfile.hasRichInline
      ? createRichInlineMeasuredTextLines(
          container,
          measuredText,
          whiteSpace,
          availableWidth,
          typography,
          resources,
        )
      : createPlainMeasuredTextLines(
          cache,
          text,
          measuredText,
          whiteSpace,
          availableWidth,
          typography,
        );

  if (lines.length === 0) {
    return [emptyMeasuredLine(0, typography.lineHeight)];
  }

  if (inlineProfile.hasHardBreak && text.endsWith("\n")) {
    lines.push(emptyMeasuredLine(text.length, typography.lineHeight));
  }

  // Pretext preserves `pre-wrap` hard breaks, but does not emit the empty
  // visual row after a trailing source newline. Materialize it so code-block
  // carets can land immediately after pressing Enter at end-of-source.
  return isPlainTextContainer(container) && text.endsWith("\n")
    ? materializeTrailingSourceTextLine(lines, text.length, typography.lineHeight)
    : lines;
}

function createPlainMeasuredTextLines(
  cache: LayoutCache,
  text: string,
  measuredText: string,
  whiteSpace: NonNullable<PrepareOptions["whiteSpace"]>,
  availableWidth: number,
  typography: BlockTypography,
) {
  const prepared = prepareTextSegments(cache, measuredText, typography.font, whiteSpace);
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

  if (lines.length > 0 && whiteSpace === "normal") {
    hangTrailingWhitespace(lines, text);
  }

  return lines;
}

// Pretext's `normal` mode collapses whitespace runs and drops leading and
// trailing whitespace, leaving those characters with no geometry or caret
// stops. Documint keeps every character, as `pre-wrap` does, while keeping
// `normal` soft wrapping. Pinning runs with no-break spaces does that: a
// leading run is pinned fully, and any longer run keeps only its last
// character collapsible as its one break opportunity, so a lone space, soft
// newline, or tab is untouched. The swap preserves UTF-16 length, so Pretext
// offsets stay source offsets. Pinned spaces glue to the word before them, so
// at a wrap point they count toward that word instead of hanging.
const COLLAPSIBLE_WHITESPACE_RUN = /^[ \t\n\f\r]+|[ \t\n\f\r]{2,}/g;
const NO_BREAK_SPACE = "\u00a0";

function pinCollapsibleWhitespace(text: string) {
  return text.replace(COLLAPSIBLE_WHITESPACE_RUN, (run: string, offset: number) =>
    offset === 0
      ? NO_BREAK_SPACE.repeat(run.length)
      : NO_BREAK_SPACE.repeat(run.length - 1) + run.at(-1),
  );
}

// The final whitespace character that pinning leaves collapsible is still
// dropped by Pretext. Hang it on the last line, as `pre-wrap` does, so typing a
// trailing space advances the caret without moving the wrap point.
function hangTrailingWhitespace(lines: MeasuredTextLine[], text: string) {
  const lastIndex = lines.length - 1;
  const last = lines[lastIndex]!;
  const end = resolveMeasuredLineEnd(text, last.start, text.length);

  if (end !== last.end) {
    lines[lastIndex] = { ...last, end, text: text.slice(last.start, end) };
  }
}

function materializeTrailingSourceTextLine(
  lines: MeasuredTextLine[],
  offset: number,
  lineHeight: number,
): MeasuredTextLine[] {
  if (lines.some((line) => line.start === offset && line.end === offset)) {
    return lines;
  }

  return [...lines, emptyMeasuredLine(offset, lineHeight)];
}

function resolveMeasuredLineEnd(text: string, start: number, end: number) {
  return end > start && text[end - 1] === "\n" ? end - 1 : end;
}

// Rich paragraphs mix fonts, atomic mentions and resources, and image boxes,
// so Pretext lays their items out as one paragraph. Each line is as tall as
// the tallest item on it, since Pretext only owns horizontal geometry.
function createRichInlineMeasuredTextLines(
  container: Extract<LayoutTextInput, { kind: "inlines" }>,
  measuredText: string,
  whiteSpace: NonNullable<PrepareOptions["whiteSpace"]>,
  availableWidth: number,
  typography: BlockTypography,
  resources: DocumentResources,
) {
  const { items, measurementItems } = createRichInlineMeasurementItems(
    container,
    measuredText,
    availableWidth,
    typography,
    resources,
  );
  const prepared = prepareRichInline(items, { whiteSpace });
  const inlineReferences = resolveInlineReferencesFromMeasurementItems(measurementItems);
  const rows: Array<{ height: number; start: number; width: number }> = [];

  walkRichInlineLineRanges(prepared, availableWidth, (line) => {
    let height = typography.lineHeight;

    for (const fragment of line.fragments) {
      height = Math.max(height, measurementItems[fragment.itemIndex]!.height);
    }

    rows.push({
      height,
      start: resolveRichInlineLineStart(prepared, measurementItems, line),
      width: line.width,
    });
  });

  // `rich-inline` trims whitespace at item edges into one-space gaps, so
  // fragment ends can stop short of the source. Tile lines instead: each runs
  // to where the next starts, short of a hard break, and the last hangs any
  // trailing whitespace.
  return rows.map(({ height, start, width }, index): MeasuredTextLine => {
    const end = resolveMeasuredLineEnd(
      container.text,
      start,
      rows[index + 1]?.start ?? container.text.length,
    );

    return {
      end,
      height,
      inlineReferences: resolveLineInlineReferences(inlineReferences, start, end),
      start,
      text: container.text.slice(start, end),
      width,
    };
  });
}

function resolveInlineReferencesFromMeasurementItems(
  measurementItems: RichInlineMeasurementItem[],
) {
  const references: LayoutInlineReference[] = [];

  for (const item of measurementItems) {
    if (item.inlineReference) {
      references.push(item.inlineReference);
    }
  }

  return references;
}

// Text items are sliced from the measured text as a whole, so whitespace runs
// that span items stay pinned.
function createRichInlineMeasurementItems(
  container: Extract<LayoutTextInput, { kind: "inlines" }>,
  measuredText: string,
  availableWidth: number,
  typography: BlockTypography,
  resources: DocumentResources,
) {
  const items: Array<RichInlineItem | RichInlineBox> = [];
  const measurementItems: RichInlineMeasurementItem[] = [];
  const context = getTextMeasurementContext();

  for (const run of containerInlines(container)) {
    const reference = resolveInlineReferenceMeasurement(run, context, {
      availableWidth,
      typography,
      resources,
    });

    if (reference) {
      items.push(reference.richItem);
      measurementItems.push({
        height: reference.height,
        inlineReference: reference.inlineReference,
        run,
      });
      continue;
    }

    items.push({
      font: resolveInlineTextStyle(typography, inlineMarks(run)).font,
      text: measuredText.slice(run.start, run.end),
    });
    measurementItems.push({
      height: typography.lineHeight,
      inlineReference: null,
      run,
    });
  }

  return {
    items,
    measurementItems,
  };
}

// A line starts at its first fragment. Text items are their run's slice of
// the container, so a fragment's source offset maps straight back to it,
// while a reference item's text is its own label and starts at its run.
function resolveRichInlineLineStart(
  prepared: PreparedRichInline,
  measurementItems: RichInlineMeasurementItem[],
  line: RichInlineLineRange,
) {
  const first = line.fragments[0]!;
  const { inlineReference, run } = measurementItems[first.itemIndex]!;

  if (inlineReference) {
    return run.start;
  }

  // Materializing only the first fragment skips building text for the rest.
  const [fragment] = materializeRichInlineLineRange(prepared, {
    ...line,
    fragments: [first],
  }).fragments;

  return run.start + fragment!.sourceStart;
}

function createCursorOffsetResolver(segments: readonly string[]) {
  const segmentOffsets: number[] = [];
  const graphemeOffsetsBySegment = new Map<number, number[]>();
  let offset = 0;

  for (const segment of segments) {
    segmentOffsets.push(offset);
    offset += segment.length;
  }

  return (cursor: LayoutCursor) => {
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

function emptyMeasuredLine(offset: number, lineHeight: number): MeasuredTextLine {
  return {
    end: offset,
    height: lineHeight,
    inlineReferences: null,
    start: offset,
    text: "",
    width: 0,
  };
}

function resolveLineInlineReferences(
  references: LayoutInlineReference[],
  startOffset: number,
  endOffset: number,
) {
  const lineReferences = references.filter(
    (reference) => reference.end > startOffset && reference.start < endOffset,
  );

  return lineReferences.length > 0 ? lineReferences : null;
}

function resolveInlineMeasurementProfile(container: LayoutTextInput): InlineMeasurementProfile {
  let hasHardBreak = false;
  let hasRichInline = false;

  if (isPlainTextContainer(container)) {
    return {
      hasHardBreak,
      hasRichInline,
    };
  }

  for (const run of containerInlines(container)) {
    if (run.node.type === "lineBreak") {
      hasHardBreak = true;
    }

    if (isReferenceInlineNode(run.node) || runHasInlineCustomMetrics(run)) {
      hasRichInline = true;
    }
  }

  return {
    hasHardBreak,
    hasRichInline,
  };
}

// Memoizes the per-path cache identity by the indexed `inlines` array
// reference. The inlines array survives index position shifts, so unchanged
// text paths hit this cache on every keystroke instead of re-hashing their
// text and re-serializing every inline.
//
// Image/resource paths are skipped because their identity also depends on
// mutable `resources` state (image load/intrinsic dimensions, resource protocol
// labels/icons); cheap to recompute.
const textIdentityByInlines = new WeakMap<
  readonly IndexedInline[],
  { identity: string; path: string; text: string }
>();

export function resolveTextMeasurementCacheIdentity(
  container: LayoutTextInput,
  resources: DocumentResources,
) {
  if (isPlainTextContainer(container)) {
    return [container.path, hashMeasurementText(container.text), ""].join(":");
  }

  const inlines = containerInlines(container);
  const cached = textIdentityByInlines.get(inlines);

  // Path and text are validated as defense-in-depth. In current code, an
  // `inlines` array reference is only reachable from a text path whose path
  // and text are also unchanged. Any content edit allocates a fresh inlines
  // array. The extra checks are essentially free and protect the cache
  // against any future code path that decouples them.
  if (cached && cached.path === container.path && cached.text === container.text) {
    return cached.identity;
  }

  const { hasResourceDependency, signature } = resolveContainerMeasurementSignature(
    container,
    resources,
  );
  const identity = [container.path, hashMeasurementText(container.text), signature].join(":");

  if (!hasResourceDependency) {
    textIdentityByInlines.set(inlines, {
      identity,
      path: container.path,
      text: container.text,
    });
  }

  return identity;
}

function resolveContainerMeasurementSignature(
  container: LayoutTextInput,
  resources: DocumentResources,
) {
  let hasResourceDependency = false;
  let signature = "";

  if (isPlainTextContainer(container)) {
    return { hasResourceDependency, signature };
  }

  for (const run of containerInlines(container)) {
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

function isPlainTextContainer(
  container: LayoutTextInput,
): container is Extract<LayoutTextInput, { kind: "plain" | "preformatted" }> {
  return container.kind !== "inlines";
}

function containerInlines(container: Extract<LayoutTextInput, { kind: "inlines" }>) {
  return container.inlines;
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
  container: LayoutTextInput,
  profile: InlineMeasurementProfile,
): NonNullable<PrepareOptions["whiteSpace"]> {
  return container.kind === "preformatted" || profile.hasHardBreak ? "pre-wrap" : "normal";
}
