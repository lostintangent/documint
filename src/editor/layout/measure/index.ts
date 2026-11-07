// Owns exact layout for a concrete set of indexed editor blocks. This module resolves
// local line, path, and block geometry without doing viewport virtualization
// or whole-document height estimation.
import { emptyDocumentResources, type DocumentResources } from "@/editor/resources";
import { isContainerBlock, type DocumentIndex, type IndexedBlock } from "../../state";
import { createLayoutCache, type LayoutCache } from "../state/cache";
import { walkLayoutBlocks } from "../lib/block-walk";
import { resolveBlockPaddingY } from "../lib/code-block";
import {
  resolveBlockContentMetrics,
  resolveBlockSurfaceLeft,
  type LayoutContentMetrics,
} from "../lib/content-metrics";
import {
  resolveDocumentLayoutOptions,
  type DocumentLayoutOptions,
  type PartialDocumentLayoutOptions,
} from "../lib/options";
import { mergeLayoutBlockExtent, type LayoutBlockExtent } from "../lib/marker-metrics";
import { layoutTable } from "./table";
import { measureMetadataPrefix, type MetadataLayout } from "./metadata";
import {
  layoutTextContainerLines,
  resolveBlockTypography,
  type LayoutTextInput,
  type LineBoundary,
} from "./text";
import type { LayoutInlineReference } from "./inline-reference";
import { resolveBlockLayoutTextInput } from "./text-input";

export type { DocumentLayoutOptions } from "../lib/options";
export type { LayoutBlockExtent } from "../lib/marker-metrics";

export type { LayoutInlineReference } from "./inline-reference";
export type { LineBoundary } from "./text";

export type LayoutLine = {
  blockPath: string | null;
  path: string;
  start: number;
  end: number;
  top: number;
  left: number;
  width: number;
  height: number;
  contentInset: number;
  text: string;
  font: string;
  boundaries: LineBoundary[];
  inlineReferences: LayoutInlineReference[] | null;
};

export type LayoutRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export type LayoutBlock = {
  bottom: number;
  blockPath: string;
  depth: number;
  top: number;
  type: DocumentIndex["blocks"][number]["block"]["type"];
};

export type PathBounds = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type DocumentLayout = {
  blocks: LayoutBlock[];
  pathBounds: Map<string, PathBounds>;
  pathLineIndices: Map<string, number[]>;
  height: number;
  lines: LayoutLine[];
  // Tallest line, which bounds how far above a window a line can start and
  // still reach into it.
  maxLineHeight: number;
  metadata: MetadataLayout | null;
  options: DocumentLayoutOptions;
  width: number;
};

export function measureLayoutSlice(
  documentIndex: DocumentIndex,
  options: PartialDocumentLayoutOptions,
  cache = createLayoutCache(),
  resources: DocumentResources | null = null,
): DocumentLayout {
  const bodyLayout = measureBodyLayoutSlice(documentIndex, options, cache, resources);
  const metadata = measureMetadataPrefix(
    documentIndex.document.metadata,
    bodyLayout.options,
    cache,
    resources ?? emptyDocumentResources,
  );

  return composeMetadataPrefix(bodyLayout, metadata);
}

export function measureBodyLayoutSlice(
  documentIndex: DocumentIndex,
  options: PartialDocumentLayoutOptions,
  cache = createLayoutCache(),
  resources: DocumentResources | null = null,
  // Seed for the body-relative running Y cursor. Defaults to
  // `options.paddingY`; metadata composition applies its document prefix
  // offset after body measurement.
  startY?: number,
  blockStartIndex = 0,
  blockEndIndex = documentIndex.blocks.length,
): DocumentLayout {
  const resolvedResources: DocumentResources = resources ?? emptyDocumentResources;
  const resolvedOptions = resolveDocumentLayoutOptions(options);
  const lines: LayoutLine[] = [];
  const pathBounds = new Map<string, PathBounds>();
  const blockExtents = new Map<string, LayoutBlockExtent>();
  const boundedBlockStartIndex = clampBlockIndex(documentIndex, blockStartIndex);
  const boundedBlockEndIndex = clampBlockIndex(documentIndex, blockEndIndex);
  const layoutBlocks = resolveLayoutBlockScope(
    documentIndex,
    boundedBlockStartIndex,
    boundedBlockEndIndex,
  );

  // Layout walks blocks so inert leaves get a positioned geometry slot in
  // document order. Text/source blocks lay out their indexed text projection;
  // tables lay out their indexed cells in one pass; inert leaves reserve a
  // fixed-height extent without emitting any line. Container blocks
  // (blockquote, list, listItem) contribute no layout themselves — their leaf
  // descendants do — so we skip them here.
  const seedY = startY ?? resolvedOptions.paddingY;
  let y = seedY;
  for (const {
    gapBefore,
    indexedBlock,
    isInert,
    previousLaidOutBlock,
    previousLaidOutBlockIsInert,
  } of walkLayoutBlocks(documentIndex, {
    blockGap: resolvedOptions.blockGap,
    layoutBlocks,
  })) {
    const block = indexedBlock.block;

    // Apply the inter-block gap before laying out (except for the first).
    if (previousLaidOutBlock !== null) {
      y += gapBefore;
      // Extend the previous block's extent to include the trailing gap so
      // that clicks in heading padding/rules still resolve to that block.
      // Inert leaves are exempt — their bounds should reflect only their
      // own geometry slot so paint can center chrome (e.g. the divider's
      // rule) symmetrically. Clicks in the gap below an inert leaf fall
      // through to the next block rather than snapping back.
      if (!previousLaidOutBlockIsInert) {
        const previousExtent = blockExtents.get(previousLaidOutBlock.path);
        if (previousExtent) {
          previousExtent.bottom = Math.max(previousExtent.bottom, y);
        }
      }
    }

    if (isInert) {
      // Inert leaves (dividers, etc.) reserve a fixed-height slot without
      // emitting lines; chrome is painted off `layout.blocks`.
      const bottom = y + resolvedOptions.lineHeight;
      blockExtents.set(indexedBlock.path, { top: y, bottom });
      y = bottom;
    } else if (block.type === "table") {
      y = layoutTable(
        lines,
        blockExtents,
        pathBounds,
        indexedBlock,
        cache,
        resolveBlockSurfaceLeft(documentIndex, indexedBlock, resolvedOptions),
        y,
        resolvedOptions,
        resolvedResources,
      );
    } else {
      const input = resolveBlockLayoutTextInput(indexedBlock);
      if (input) {
        y = layoutSingleContainer(
          lines,
          blockExtents,
          pathBounds,
          input,
          cache,
          indexedBlock,
          resolveBlockContentMetrics(documentIndex, indexedBlock, resolvedOptions),
          y,
          resolvedOptions,
          resolvedResources,
        );
      }
    }
  }

  // `layout.blocks` is the per-leaf-block bounding-box index used by the
  // hit-test gap fallback and by the inert-block paint dispatch. Container
  // blocks (blockquote, list, listItem) are excluded — they have no own
  // geometry; their leaf descendants do. Sorted by `top` to support
  // binary-search visibility scoping in the paint pass.
  const blocks: LayoutBlock[] = [];
  for (const entry of layoutBlocks) {
    if (isContainerBlock(entry)) continue;
    const extent = blockExtents.get(entry.path);
    if (!extent) continue;
    blocks.push({
      bottom: extent.bottom,
      blockPath: entry.path,
      depth: entry.depth,
      top: extent.top,
      type: entry.block.type,
    });
  }

  return {
    blocks,
    pathBounds,
    pathLineIndices: createPathLineIndices(lines),
    height: Math.max(y, seedY),
    lines,
    maxLineHeight: resolveMaxLineHeight(lines),
    metadata: null,
    options: resolvedOptions,
    width: resolvedOptions.width,
  };
}

export function composeMetadataPrefix(
  bodyLayout: DocumentLayout,
  metadata: MetadataLayout | null,
): DocumentLayout {
  if (!metadata) {
    return bodyLayout;
  }

  // Body lines are already sorted and indexed, and they all sit below the
  // metadata block, so only the metadata lines need sorting and the body
  // indices shift past them.
  const bodyOffset = metadata.bodyOffset;
  const lines: LayoutLine[] = [...metadata.lines];
  const pathLineIndices = createPathLineIndices(lines);

  for (const [path, indices] of bodyLayout.pathLineIndices) {
    pathLineIndices.set(
      path,
      indices.map((index) => index + metadata.lines.length),
    );
  }

  for (const line of bodyLayout.lines) {
    lines.push({ ...line, top: line.top + bodyOffset });
  }

  const pathBounds = new Map(metadata.pathBounds);

  for (const [path, bounds] of bodyLayout.pathBounds) {
    pathBounds.set(path, {
      bottom: bounds.bottom + bodyOffset,
      left: bounds.left,
      right: bounds.right,
      top: bounds.top + bodyOffset,
    });
  }

  return {
    ...bodyLayout,
    blocks: bodyLayout.blocks.map((block) => ({
      ...block,
      bottom: block.bottom + bodyOffset,
      top: block.top + bodyOffset,
    })),
    height: bodyLayout.height + bodyOffset,
    lines,
    maxLineHeight: Math.max(bodyLayout.maxLineHeight, resolveMaxLineHeight(metadata.lines)),
    metadata,
    pathBounds,
    pathLineIndices,
  };
}

function resolveLayoutBlockScope(
  documentIndex: DocumentIndex,
  blockStartIndex: number,
  blockEndIndex: number,
) {
  return blockStartIndex === 0 && blockEndIndex === documentIndex.blocks.length
    ? documentIndex.blocks
    : documentIndex.blocks.slice(blockStartIndex, blockEndIndex);
}

function clampBlockIndex(documentIndex: DocumentIndex, index: number) {
  return Math.max(0, Math.min(documentIndex.blocks.length, index));
}

function layoutSingleContainer(
  lines: LayoutLine[],
  blockExtents: Map<string, LayoutBlockExtent>,
  pathBounds: DocumentLayout["pathBounds"],
  container: LayoutTextInput,
  cache: LayoutCache,
  indexedBlock: IndexedBlock,
  contentMetrics: LayoutContentMetrics,
  top: number,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  const { block, path: blockPath } = indexedBlock;
  const typography = resolveBlockTypography(block, options.fontSize, options.lineHeight);
  const blockPaddingY = resolveBlockPaddingY(block);
  let y = top + blockPaddingY;
  const containerLines = layoutTextContainerLines(
    cache,
    container,
    contentMetrics.availableWidth,
    typography,
    resources,
    {
      blockPath,
      contentInset: contentMetrics.listInset,
      left: contentMetrics.contentLeft,
      top: y,
    },
  );

  for (const line of containerLines) {
    lines.push(line);
    mergeLayoutBlockExtent(blockExtents, blockPath, line.top, line.top + line.height);
    updatePathBoundsFromLine(pathBounds, line);
    y += line.height;
  }

  if (blockPaddingY > 0) {
    const current = blockExtents.get(blockPath);
    if (current) {
      blockExtents.set(blockPath, {
        bottom: current.bottom + blockPaddingY,
        top: current.top - blockPaddingY,
      });
    }
  }

  return y + blockPaddingY;
}

function createPathLineIndices(lines: LayoutLine[]) {
  // Sort in place — table cell layout interleaves Y across the cells of a
  // row, so lines need one top order for the paint and hit-test searches.
  // Their bottoms stay unsorted within a row. Left only breaks ties for a
  // reading order, and metadata composition can tie tops without re-sorting,
  // so no search may rely on it. (Cloning + `lines.push(...sortedLines)` also
  // blows the call stack on long docs via spread-as-args.)
  lines.sort((left, right) => left.top - right.top || left.left - right.left);

  const entries = new Map<string, number[]>();
  for (let index = 0; index < lines.length; index += 1) {
    const path = lines[index]!.path;
    const current = entries.get(path);
    if (current) {
      current.push(index);
    } else {
      entries.set(path, [index]);
    }
  }

  return entries;
}

function resolveMaxLineHeight(lines: readonly LayoutLine[]) {
  let maxLineHeight = 0;

  for (const line of lines) {
    maxLineHeight = Math.max(maxLineHeight, line.height);
  }

  return maxLineHeight;
}

// Folds a single line's geometry into its path's running bounds. Called once
// per line as it is appended, replacing the prior pattern of a per-path
// `lines.filter(...)` (O(N) inside an N-path loop) plus a final full re-walk.
function updatePathBoundsFromLine(pathBounds: DocumentLayout["pathBounds"], line: LayoutLine) {
  const current = pathBounds.get(line.path);

  pathBounds.set(line.path, {
    bottom: Math.max(current?.bottom ?? -Infinity, line.top + line.height),
    left: Math.min(current?.left ?? Infinity, line.left),
    right: Math.max(current?.right ?? -Infinity, line.left + line.width),
    top: Math.min(current?.top ?? Infinity, line.top),
  });
}
