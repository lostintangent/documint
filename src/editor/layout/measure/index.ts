// Owns exact layout for a concrete set of editor regions. This module resolves
// local line, region, and block geometry without doing viewport virtualization
// or whole-document height estimation.
import type { Block } from "@/document";
import { emptyDocumentResources } from "@/editor/resources";
import type { DocumentResources } from "@/types";
import { isContainerBlock, isInertBlock, resolveRegion } from "../../state/index/query";
import type { DocumentIndex, RegionEntry } from "../../state";
import { createLayoutCache, type LayoutCache } from "../state/cache";
import { CODE_BLOCK_BACKGROUND_PADDING_Y } from "../lib/code-block";
import {
  resolveDocumentLayoutOptions,
  type DocumentLayoutOptions,
  type PartialDocumentLayoutOptions,
} from "../lib/options";
import { CODE_BLOCK_CONTENT_PADDING_X } from "../lib/code-block";
import { resolveBlockGap } from "../lib/block-spacing";
import { resolveListMarkerInset, type LayoutBlockExtent } from "../lib/marker-metrics";
import { layoutTable } from "./table";
import {
  measureTextContainerLines,
  measureTextLineBoundaries,
  resolveTextBlockFont,
  resolveTextBlockLineHeight,
  type TextLineBoundary,
} from "./text";

export type { DocumentLayoutOptions } from "../lib/options";
export type { LayoutBlockExtent } from "../lib/marker-metrics";

export type DocumentLineBoundary = TextLineBoundary;

export type DocumentLayoutLine = {
  blockId: string;
  boundaries: DocumentLineBoundary[];
  regionId: string;
  end: number;
  font: string;
  height: number;
  left: number;
  start: number;
  text: string;
  top: number;
  width: number;
};

export type DocumentLayoutBlock = {
  bottom: number;
  depth: number;
  id: string;
  top: number;
  type: DocumentIndex["blocks"][number]["block"]["type"];
};

export type DocumentLayout = {
  blocks: DocumentLayoutBlock[];
  regionBounds: Map<string, { bottom: number; left: number; right: number; top: number }>;
  regionLineIndices: Map<string, number[]>;
  height: number;
  lines: DocumentLayoutLine[];
  options: DocumentLayoutOptions;
  width: number;
};

export function measureLayoutSlice(
  documentIndex: DocumentIndex,
  options: PartialDocumentLayoutOptions,
  cache = createLayoutCache(),
  resources: DocumentResources | null = null,
  // The block map is a pure projection of `documentIndex.document.blocks`,
  // so callers that already built one (`createEditorLayoutState`, the
  // virtualizer) thread it in to avoid rebuilding it per slice.
  precomputedBlockMap?: Map<string, Block>,
  // Seed for the running Y cursor. Defaults to `options.paddingY` (slice-
  // local coordinates). The virtualizer passes the document-space top of
  // the slice so geometry emerges directly in document space and no
  // post-measurement shift is needed.
  startY?: number,
): DocumentLayout {
  const resolvedResources: DocumentResources = resources ?? emptyDocumentResources;
  const resolvedOptions = resolveDocumentLayoutOptions(options);
  const lines: DocumentLayoutLine[] = [];
  const regionBounds = new Map<
    string,
    { bottom: number; left: number; right: number; top: number }
  >();
  const runtimeBlocks = documentIndex.blockIndex;
  const blockMap = precomputedBlockMap ?? buildDocumentBlockMap(documentIndex.document.blocks);
  const blockExtents = new Map<string, LayoutBlockExtent>();

  // Layout walks blocks (not regions) so inert leaves — those without
  // any region — get a positioned geometry slot in document order. Text
  // blocks dispatch through their regions; tables slurp all their cell
  // regions in one pass; inert leaves reserve a fixed-height extent
  // without emitting any line. Container blocks (blockquote, list,
  // listItem) contribute no layout themselves — their leaf descendants
  // do — so we skip them here.
  const visibleRegionIds = new Set(documentIndex.regions.map((r) => r.id));
  const seedY = startY ?? resolvedOptions.paddingY;
  let y = seedY;
  // Cached as the runtime block, not just its id, so the trailing-gap
  // step can read its `type` without re-querying `blockIndex.get`.
  let previousLaidOutBlock: DocumentIndex["blocks"][number] | null = null;

  for (const blockEntry of documentIndex.blocks) {
    const block = blockMap.get(blockEntry.block.id) ?? null;
    if (!block || isContainerBlock(blockEntry)) continue;

    const isInert = isInertBlock(blockEntry);
    const blockRegionsInScope = blockEntry.regionIds.filter((id) => visibleRegionIds.has(id));

    // Skip text/table blocks whose regions aren't in this layout pass
    // (e.g. when called with a sliced regions array). Inert leaves are
    // always laid out — they're cheap and estimation accounts for their
    // height so adjacent regions land at consistent Y.
    if (!isInert && blockRegionsInScope.length === 0) continue;

    // Apply the inter-block gap before laying out (except for the first).
    if (previousLaidOutBlock !== null) {
      y += resolveBlockGap(
        runtimeBlocks,
        blockMap,
        previousLaidOutBlock.block.id,
        blockEntry.block.id,
        resolvedOptions.blockGap,
      );
      // Extend the previous block's extent to include the trailing gap so
      // that clicks in heading padding/rules still resolve to that block.
      // Inert leaves are exempt — their bounds should reflect only their
      // own geometry slot so paint can center chrome (e.g. the divider's
      // rule) symmetrically. Clicks in the gap below an inert leaf fall
      // through to the next block rather than snapping back.
      if (!isInertBlock(previousLaidOutBlock)) {
        const previousExtent = blockExtents.get(previousLaidOutBlock.block.id);
        if (previousExtent) {
          previousExtent.bottom = Math.max(previousExtent.bottom, y);
        }
      }
    }

    const depth = blockEntry.depth;
    const left = resolvedOptions.paddingX + depth * resolvedOptions.indentWidth;
    const listInset = resolveListMarkerInset(documentIndex, blockEntry.block.id);
    const codeContentInset = block.type === "code" ? CODE_BLOCK_CONTENT_PADDING_X : 0;
    const contentLeft = left + codeContentInset;
    const availableWidth = Math.max(
      40,
      resolvedOptions.width - left - resolvedOptions.paddingX - listInset - codeContentInset * 2,
    );

    if (isInert) {
      // Inert leaves (dividers, etc.) reserve a fixed-height slot without
      // emitting lines; chrome is painted off `layout.blocks`.
      const bottom = y + resolvedOptions.lineHeight;
      blockExtents.set(blockEntry.block.id, { top: y, bottom });
      y = bottom;
    } else if (block.type === "table") {
      const tableContainers = blockRegionsInScope
        .map((id) => resolveRegion(documentIndex, id))
        .filter((r): r is RegionEntry => r !== null);
      y = layoutTable(
        lines,
        blockExtents,
        regionBounds,
        tableContainers,
        cache,
        block,
        left,
        y,
        resolvedOptions,
        resolvedResources,
      );
    } else {
      for (const regionId of blockRegionsInScope) {
        const container = resolveRegion(documentIndex, regionId);
        if (!container) continue;
        y = layoutSingleContainer(
          lines,
          blockExtents,
          regionBounds,
          container,
          cache,
          block,
          contentLeft,
          y,
          availableWidth,
          resolvedOptions,
          resolvedResources,
        );
      }
    }

    previousLaidOutBlock = blockEntry;
  }

  // `layout.blocks` is the per-leaf-block bounding-box index used by the
  // hit-test gap fallback and by the inert-block paint dispatch. Container
  // blocks (blockquote, list, listItem) are excluded — they have no own
  // geometry; their leaf descendants do. Sorted by `top` to support
  // binary-search visibility scoping in the paint pass.
  const blocks: DocumentLayoutBlock[] = [];
  for (const entry of documentIndex.blocks) {
    const runtimeBlock = blockMap.get(entry.block.id);
    if (!runtimeBlock || isContainerBlock(entry)) continue;
    const extent = blockExtents.get(entry.block.id);
    if (!extent) continue;
    blocks.push({
      bottom: extent.bottom,
      depth: entry.depth,
      id: entry.block.id,
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

function layoutSingleContainer(
  lines: DocumentLayoutLine[],
  blockExtents: Map<string, LayoutBlockExtent>,
  regionBounds: DocumentLayout["regionBounds"],
  container: DocumentIndex["regions"][number],
  cache: LayoutCache,
  block: Block | null,
  left: number,
  top: number,
  availableWidth: number,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  const font = resolveTextBlockFont(block);
  const lineHeight = resolveTextBlockLineHeight(block, options.lineHeight);
  const blockPaddingY = block?.type === "code" ? CODE_BLOCK_BACKGROUND_PADDING_Y : 0;
  const measuredLines = measureTextContainerLines(
    cache,
    container,
    font,
    block,
    availableWidth,
    lineHeight,
    resources,
  );
  let y = top + blockPaddingY;
  for (const line of measuredLines) {
    const layoutLine = {
      blockId: container.block.id,
      boundaries: measureTextLineBoundaries(
        cache,
        container,
        line.start,
        line.end,
        line.text,
        font,
        availableWidth,
        resources,
      ),
      regionId: container.id,
      end: line.end,
      font,
      height: line.height,
      left,
      start: line.start,
      text: line.text,
      top: y,
      width: line.width,
    } satisfies DocumentLayoutLine;

    lines.push(layoutLine);
    updateBlockExtent(blockExtents, layoutLine);
    updateRegionBoundsFromLine(regionBounds, layoutLine);
    y += line.height;
  }

  if (block?.type === "code") {
    const current = blockExtents.get(container.block.id);

    if (current) {
      blockExtents.set(container.block.id, {
        bottom: current.bottom + blockPaddingY,
        top: current.top - blockPaddingY,
      });
    }
  }

  return y + blockPaddingY;
}

function createContainerLineIndices(lines: DocumentLayoutLine[]) {
  // Sort in place — table cell layout can interleave Y across the cells of
  // a row, so we need a single top-then-left order to feed binary search
  // in the paint/hit-test passes. (Cloning + `lines.push(...sortedLines)`
  // also blows the call stack on long docs via spread-as-args.)
  lines.sort((left, right) => left.top - right.top || left.left - right.left);

  const entries = new Map<string, number[]>();
  for (let index = 0; index < lines.length; index += 1) {
    const regionId = lines[index]!.regionId;
    const current = entries.get(regionId);
    if (current) {
      current.push(index);
    } else {
      entries.set(regionId, [index]);
    }
  }

  return entries;
}

// Folds a single line's geometry into its region's running bounds. Called
// once per line as it is appended, replacing the prior pattern of a per-region
// `lines.filter(...)` (O(N) inside an N-region loop) plus a final full re-walk.
function updateRegionBoundsFromLine(
  regionBounds: DocumentLayout["regionBounds"],
  line: DocumentLayoutLine,
) {
  const current = regionBounds.get(line.regionId);
  const right = line.left + line.width;
  const bottom = line.top + line.height;

  regionBounds.set(
    line.regionId,
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
  line: Pick<DocumentLayoutLine, "blockId" | "height" | "top">,
) {
  const current = blockExtents.get(line.blockId);
  const nextBottom = line.top + line.height;

  blockExtents.set(line.blockId, {
    bottom: current ? Math.max(current.bottom, nextBottom) : nextBottom,
    top: current ? Math.min(current.top, line.top) : line.top,
  });
}

export function buildDocumentBlockMap(blocks: Block[]) {
  const entries = new Map<string, Block>();

  const visit = (candidateBlocks: Block[]) => {
    for (const block of candidateBlocks) {
      entries.set(block.id, block);

      if (block.type === "blockquote" || block.type === "listItem") {
        visit(block.children);
      } else if (block.type === "list") {
        visit(block.items);
      }
    }
  };

  visit(blocks);

  return entries;
}
