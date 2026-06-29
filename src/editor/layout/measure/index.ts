// Owns exact layout for a concrete set of editor regions. This module resolves
// local line, region, and block geometry without doing viewport virtualization
// or whole-document height estimation.
import type { Block } from "@/document";
import { emptyDocumentResources } from "@/editor/resources";
import type { DocumentResources } from "@/types";
import { isContainerBlock, resolveIndexedBlock, type DocumentIndex } from "../../state";
import { createLayoutCache, type LayoutCache } from "../state/cache";
import { walkLayoutBlocks } from "../lib/block-walk";
import { CODE_BLOCK_BACKGROUND_PADDING_Y } from "../lib/code-block";
import { resolveBlockContentMetrics } from "../lib/content-metrics";
import {
  resolveDocumentLayoutOptions,
  type DocumentLayoutOptions,
  type PartialDocumentLayoutOptions,
} from "../lib/options";
import { mergeLayoutBlockExtent, type LayoutBlockExtent } from "../lib/marker-metrics";
import { layoutTable } from "./table";
import {
  measureTextContainerLines,
  measureTextLineBoundaries,
  resolveBlockTypography,
  type TextLineBoundary,
  type TextInlineReference,
} from "./text";

export type { DocumentLayoutOptions } from "../lib/options";
export type { LayoutBlockExtent } from "../lib/marker-metrics";

export type LineBoundary = TextLineBoundary;
export type LayoutInlineReference = TextInlineReference;

export type LayoutLine = {
  // Identity: connects this visual row back to indexed editor content.
  blockPath: string;
  regionPath: string;
  // Model span: offsets and text slice from the owning editable region.
  start: number;
  end: number;
  // Geometry: document-space rectangle occupied by this visual row.
  top: number;
  left: number;
  width: number;
  height: number;
  contentInset: number;
  // Rendering and caret data.
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

export type DocumentLayout = {
  blocks: LayoutBlock[];
  regionBounds: Map<string, { bottom: number; left: number; right: number; top: number }>;
  regionLineIndices: Map<string, number[]>;
  height: number;
  lines: LayoutLine[];
  options: DocumentLayoutOptions;
  width: number;
};

export function measureLayoutSlice(
  documentIndex: DocumentIndex,
  options: PartialDocumentLayoutOptions,
  cache = createLayoutCache(),
  resources: DocumentResources | null = null,
  // Seed for the running Y cursor. Defaults to `options.paddingY` (slice-
  // local coordinates). The virtualizer passes the document-space top of
  // the slice so geometry emerges directly in document space and no
  // post-measurement shift is needed.
  startY?: number,
  regionStartIndex = 0,
  regionEndIndex = documentIndex.regions.length,
): DocumentLayout {
  const resolvedResources: DocumentResources = resources ?? emptyDocumentResources;
  const resolvedOptions = resolveDocumentLayoutOptions(options);
  const lines: LayoutLine[] = [];
  const regionBounds = new Map<
    string,
    { bottom: number; left: number; right: number; top: number }
  >();
  const blockExtents = new Map<string, LayoutBlockExtent>();
  const boundedRegionStartIndex = clampRegionIndex(documentIndex, regionStartIndex);
  const boundedRegionEndIndex = clampRegionIndex(documentIndex, regionEndIndex);
  const layoutBlocks = resolveLayoutBlockScope(
    documentIndex,
    boundedRegionStartIndex,
    boundedRegionEndIndex,
  );

  // Layout walks blocks (not regions) so inert leaves — those without
  // any region — get a positioned geometry slot in document order. Text
  // blocks dispatch through their regions; tables slurp all their cell
  // regions in one pass; inert leaves reserve a fixed-height extent
  // without emitting any line. Container blocks (blockquote, list,
  // listItem) contribute no layout themselves — their leaf descendants
  // do — so we skip them here.
  const seedY = startY ?? resolvedOptions.paddingY;
  let y = seedY;
  for (const {
    gapBefore,
    indexedBlock,
    isInert,
    previousLaidOutBlock,
    previousLaidOutBlockIsInert,
    regionEndIndex: blockRegionEndIndex,
    regionStartIndex: blockRegionStartIndex,
  } of walkLayoutBlocks(documentIndex, {
    blockGap: resolvedOptions.blockGap,
    layoutBlocks,
    visibleRegionEndIndex: boundedRegionEndIndex,
    visibleRegionStartIndex: boundedRegionStartIndex,
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

    const contentMetrics = resolveBlockContentMetrics(documentIndex, indexedBlock, resolvedOptions);

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
        regionBounds,
        documentIndex.regions,
        blockRegionStartIndex,
        blockRegionEndIndex,
        cache,
        block,
        indexedBlock.path,
        contentMetrics.left,
        y,
        resolvedOptions,
        resolvedResources,
      );
    } else {
      for (let regionIndex = blockRegionStartIndex; regionIndex < blockRegionEndIndex; regionIndex += 1) {
        const container = documentIndex.regions[regionIndex];
        if (!container) continue;

        y = layoutSingleContainer(
          lines,
          blockExtents,
          regionBounds,
          container,
          cache,
          block,
          indexedBlock.path,
          contentMetrics.contentLeft,
          y,
          contentMetrics.availableWidth,
          contentMetrics.listInset,
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
    regionBounds,
    regionLineIndices: createContainerLineIndices(lines),
    height: Math.max(y, seedY),
    lines,
    options: resolvedOptions,
    width: resolvedOptions.width,
  };
}

function resolveLayoutBlockScope(
  documentIndex: DocumentIndex,
  regionStartIndex: number,
  regionEndIndex: number,
) {
  if (regionStartIndex === 0 && regionEndIndex === documentIndex.regions.length) {
    return documentIndex.blocks;
  }

  if (regionStartIndex >= regionEndIndex) {
    return [];
  }

  const firstRegion = documentIndex.regions[regionStartIndex];
  const lastRegion = documentIndex.regions[regionEndIndex - 1];
  const firstBlock = firstRegion
    ? resolveIndexedBlock(documentIndex, firstRegion.blockPath)
    : null;
  const lastBlock = lastRegion ? resolveIndexedBlock(documentIndex, lastRegion.blockPath) : null;

  if (!firstBlock || !lastBlock) {
    return [];
  }

  const blockStartIndex = Math.min(firstBlock.blockArrayIndex, lastBlock.blockArrayIndex);
  const blockEndIndex = Math.max(firstBlock.blockArrayIndex, lastBlock.blockArrayIndex) + 1;

  return documentIndex.blocks.slice(blockStartIndex, blockEndIndex);
}

function clampRegionIndex(documentIndex: DocumentIndex, index: number) {
  if (!Number.isFinite(index)) {
    return 0;
  }

  return Math.max(0, Math.min(documentIndex.regions.length, Math.trunc(index)));
}

function layoutSingleContainer(
  lines: LayoutLine[],
  blockExtents: Map<string, LayoutBlockExtent>,
  regionBounds: DocumentLayout["regionBounds"],
  container: DocumentIndex["regions"][number],
  cache: LayoutCache,
  block: Block | null,
  blockPath: string,
  left: number,
  top: number,
  availableWidth: number,
  contentInset: number,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  const typography = resolveBlockTypography(block, options.fontSize, options.lineHeight);
  const blockPaddingY = block?.type === "code" ? CODE_BLOCK_BACKGROUND_PADDING_Y : 0;
  const measuredLines = measureTextContainerLines(
    cache,
    container,
    block,
    availableWidth,
    typography,
    resources,
  );
  let y = top + blockPaddingY;
  for (const line of measuredLines) {
    const layoutLine = {
      blockPath,
      regionPath: container.path,
      start: line.start,
      end: line.end,
      top: y,
      left,
      width: line.width,
      height: line.height,
      contentInset,
      text: line.text,
      font: typography.font,
      inlineReferences: line.inlineReferences,
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
    } satisfies LayoutLine;

    lines.push(layoutLine);
    updateBlockExtent(blockExtents, layoutLine);
    updateRegionBoundsFromLine(regionBounds, layoutLine);
    y += line.height;
  }

  if (block?.type === "code") {
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

function createContainerLineIndices(lines: LayoutLine[]) {
  // Sort in place — table cell layout can interleave Y across the cells of
  // a row, so we need a single top-then-left order to feed binary search
  // in the paint/hit-test passes. (Cloning + `lines.push(...sortedLines)`
  // also blows the call stack on long docs via spread-as-args.)
  lines.sort((left, right) => left.top - right.top || left.left - right.left);

  const entries = new Map<string, number[]>();
  for (let index = 0; index < lines.length; index += 1) {
    const regionPath = lines[index]!.regionPath;
    const current = entries.get(regionPath);
    if (current) {
      current.push(index);
    } else {
      entries.set(regionPath, [index]);
    }
  }

  return entries;
}

// Folds a single line's geometry into its region's running bounds. Called
// once per line as it is appended, replacing the prior pattern of a per-region
// `lines.filter(...)` (O(N) inside an N-region loop) plus a final full re-walk.
function updateRegionBoundsFromLine(
  regionBounds: DocumentLayout["regionBounds"],
  line: LayoutLine,
) {
  const current = regionBounds.get(line.regionPath);
  const right = line.left + line.width;
  const bottom = line.top + line.height;

  regionBounds.set(
    line.regionPath,
    current
      ? {
          bottom: Math.max(current.bottom, bottom),
          left: Math.min(current.left, line.left),
          right: Math.max(current.right, right),
          top: Math.min(current.top, line.top),
        }
      : {
          bottom,
          left: line.left,
          right,
          top: line.top,
        },
  );
}

export function updateBlockExtent(
  blockExtents: Map<string, LayoutBlockExtent>,
  line: Pick<LayoutLine, "blockPath" | "height" | "top">,
) {
  mergeLayoutBlockExtent(blockExtents, line.blockPath, line.top, line.top + line.height);
}
