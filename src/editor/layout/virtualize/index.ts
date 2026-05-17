// Owns large-document layout virtualization: whole-document height estimates,
// viewport slice selection, exact slice measurement, and refinement of cached
// estimates from measured geometry.

import type { Block } from "@/document";
import type { DocumentResources } from "@/types";
import { isContainerBlock, isInertBlock } from "../../navigation/flow";
import type { DocumentIndex, EditorRegion, EditorState } from "../../state";
import {
  getVirtualLayout,
  setVirtualLayout,
  type LayoutCache,
  type VirtualLayout,
} from "../state/cache";
import { resolveListMarkerInset } from "../lib/geometry";
import type { DocumentLayoutOptions } from "../lib/options";
import { resolveBlockGap } from "../lib/spacing";
import { measureLayoutSlice, type DocumentLayout } from "../measure";
import { TABLE_CELL_PADDING_X, TABLE_CELL_PADDING_Y, TABLE_MIN_WIDTH } from "../measure/table";
import { resolveTextBlockLineHeight } from "../measure/text";
import { estimateContainerHeight, estimateTableCellHeight } from "./estimate";
import { refineVirtualLayoutWithMeasuredSlice } from "./refine";
import {
  expandViewportSliceToBlockBoundaries,
  findVirtualLayoutEntryIndexAtOrAfter,
  updateMeasuredContainerHeights,
} from "./slice";

type VirtualizedViewport = {
  height: number;
  overscan: number;
  top: number;
};

export type VirtualizedLayoutSlice = {
  estimateRegionBounds: (regionId: string) => { bottom: number; top: number } | null;
  layout: DocumentLayout;
  totalHeight: number;
};

export function createVirtualizedLayoutSlice({
  blockMap,
  cache,
  documentIndex,
  options,
  resources,
  runtimeBlocks,
  state,
  viewport,
}: {
  blockMap: Map<string, Block>;
  cache: LayoutCache;
  documentIndex: DocumentIndex;
  options: DocumentLayoutOptions;
  resources: DocumentResources;
  runtimeBlocks: Map<string, DocumentIndex["blocks"][number]>;
  state: EditorState;
  viewport: VirtualizedViewport;
}): VirtualizedLayoutSlice {
  const expandedTop = Math.max(0, viewport.top - viewport.overscan);
  const expandedBottom = viewport.top + viewport.height + viewport.overscan;
  const virtualLayout = getOrCreateVirtualLayout(
    cache,
    documentIndex,
    blockMap,
    runtimeBlocks,
    options,
    resources,
  );
  let sliceStartIndex = findVirtualLayoutEntryIndexAtOrAfter(virtualLayout, expandedTop);
  let sliceEndIndex = findVirtualLayoutEntryIndexAtOrAfter(virtualLayout, expandedBottom);

  if (sliceStartIndex > 0) {
    const previous = virtualLayout.entries[sliceStartIndex - 1];

    if (previous && previous.bottom > expandedTop) {
      sliceStartIndex -= 1;
    }
  }

  if (sliceEndIndex < virtualLayout.entries.length) {
    const next = virtualLayout.entries[sliceEndIndex];

    if (next && next.top < expandedBottom) {
      sliceEndIndex += 1;
    }
  }

  const pinTop = Math.max(0, expandedTop - viewport.overscan);
  const pinBottom = expandedBottom + viewport.overscan;
  const pinned = new Set([state.selection.anchor.regionId, state.selection.focus.regionId]);

  for (const regionId of pinned) {
    const index = virtualLayout.containerIndices.get(regionId);
    const bounds = virtualLayout.estimateRegionBounds(regionId);

    if (index === undefined || !bounds) {
      continue;
    }

    if (bounds.bottom < pinTop || bounds.top > pinBottom) {
      continue;
    }

    sliceStartIndex = Math.min(sliceStartIndex, index);
    sliceEndIndex = Math.max(sliceEndIndex, index + 1);
  }

  let layout: DocumentLayout;

  if (!Number.isFinite(sliceStartIndex) || !Number.isFinite(sliceEndIndex)) {
    layout = measureLayoutSlice(
      {
        ...documentIndex,
        regions: [],
      },
      options,
      cache,
      resources,
      blockMap,
    );
  } else {
    const expandedSlice = expandViewportSliceToBlockBoundaries(
      documentIndex,
      runtimeBlocks,
      virtualLayout.containerIndices,
      sliceStartIndex,
      sliceEndIndex,
    );
    const sliceTop = virtualLayout.entries[expandedSlice.startIndex]?.top ?? options.paddingY;
    // Seed measurement at the slice's document-space top so geometry is
    // produced directly in document coordinates — no post-shift needed.
    // Override `height` with the full-document estimate so consumers that
    // read `layout.height` (scrollbars, paint extents) see the doc height,
    // not the slice height.
    const sliceLayout = measureLayoutSlice(
      {
        ...documentIndex,
        regions: documentIndex.regions.slice(expandedSlice.startIndex, expandedSlice.endIndex),
      },
      options,
      cache,
      resources,
      blockMap,
      sliceTop,
    );

    layout = { ...sliceLayout, height: virtualLayout.totalHeight };

    updateMeasuredContainerHeights(cache, documentIndex, layout, options, resources);

    if (refineVirtualLayoutWithMeasuredSlice(virtualLayout, documentIndex, layout)) {
      layout = {
        ...layout,
        height: virtualLayout.totalHeight,
      };
    }
  }

  return {
    estimateRegionBounds: virtualLayout.estimateRegionBounds,
    layout,
    totalHeight: virtualLayout.totalHeight,
  };
}

function getOrCreateVirtualLayout(
  cache: LayoutCache,
  documentIndex: DocumentIndex,
  blockMap: Map<string, Block>,
  runtimeBlocks: Map<string, DocumentIndex["blocks"][number]>,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  const cacheKey = createVirtualLayoutCacheKey(documentIndex, options, resources);
  const cached = getVirtualLayout(cache, documentIndex, cacheKey);

  if (cached) {
    return cached;
  }

  // Estimation walks blocks (mirroring `measureLayoutSlice`). Inert leaf
  // blocks contribute fixed height to `totalHeight` so subsequent regions
  // land at Y positions consistent with what layout actually produces.
  // They have no virtual-layout entry — the entries array stays 1:1 with
  // `documentIndex.regions`. Container blocks (blockquote, list,
  // listItem) are skipped here just as in layout — their leaf descendants
  // emit the actual entries.
  let totalHeight = options.paddingY;
  // Sparse array — entries[i] corresponds to documentIndex.regions[i]; slots
  // for inert leaves (which have no region) are never written.
  const entries: VirtualLayout["entries"] = [];
  const containerIndices = new Map<string, number>();
  let regionCursor = 0;
  let previousLaidOutBlockId: string | null = null;

  for (const blockEntry of documentIndex.blocks) {
    const block = blockMap.get(blockEntry.id) ?? null;
    if (!block || isContainerBlock(block)) continue;

    const isInert = isInertBlock(blockEntry);
    if (!isInert && blockEntry.regionIds.length === 0) continue;

    if (previousLaidOutBlockId !== null) {
      totalHeight += resolveBlockGap(
        runtimeBlocks,
        blockMap,
        previousLaidOutBlockId,
        blockEntry.id,
        options.blockGap,
      );
    }

    if (isInert) {
      totalHeight += options.lineHeight;
    } else if (block.type === "table") {
      const result = appendTableEstimateEntries({
        block,
        containerIndices,
        entries,
        index: regionCursor,
        options,
        runtimeBlocks,
        totalHeight,
        regions: documentIndex.regions,
      });
      if (result) {
        regionCursor = result.nextIndex;
        totalHeight = result.totalHeight;
      }
    } else {
      const listInset = resolveListMarkerInset(documentIndex, blockEntry.id);
      for (const _regionId of blockEntry.regionIds) {
        const container = documentIndex.regions[regionCursor];
        if (!container) {
          regionCursor += 1;
          continue;
        }
        const estimatedHeight = estimateContainerHeight(
          cache,
          container,
          block,
          blockEntry.depth,
          listInset,
          options,
          resources,
        );
        const top = totalHeight;
        const bottom = top + estimatedHeight;
        entries[regionCursor] = { bottom, top };
        containerIndices.set(container.id, regionCursor);
        totalHeight = bottom;
        regionCursor += 1;
      }
    }

    previousLaidOutBlockId = blockEntry.id;
  }

  return setVirtualLayout(cache, documentIndex, cacheKey, {
    containerIndices,
    entries,
    estimateRegionBounds(regionId) {
      const index = containerIndices.get(regionId);

      return index === undefined ? null : (entries[index] ?? null);
    },
    totalHeight,
  });
}

function appendTableEstimateEntries({
  block,
  containerIndices,
  entries,
  index,
  options,
  runtimeBlocks,
  totalHeight,
  regions,
}: {
  block: Extract<Block, { type: "table" }>;
  containerIndices: Map<string, number>;
  entries: VirtualLayout["entries"];
  index: number;
  options: DocumentLayoutOptions;
  runtimeBlocks: Map<string, DocumentIndex["blocks"][number]>;
  totalHeight: number;
  regions: DocumentIndex["regions"];
}) {
  const runtimeBlock = runtimeBlocks.get(block.id);
  const tableRegionIds = runtimeBlock?.regionIds ?? [];

  if (tableRegionIds.length === 0) {
    return null;
  }

  const tableRegions = regions.slice(index, index + tableRegionIds.length);

  if (tableRegions.length === 0 || tableRegions[0]?.blockId !== block.id) {
    return null;
  }

  const depth = runtimeBlock?.depth ?? 0;
  const left = options.paddingX + depth * options.indentWidth;
  const tableWidth = Math.max(TABLE_MIN_WIDTH, options.width - left - options.paddingX);
  const columnCount = Math.max(1, ...block.rows.map((row) => row.cells.length));
  const columnWidth = tableWidth / columnCount;
  const cellWidth = Math.max(40, columnWidth - TABLE_CELL_PADDING_X * 2);
  const lineHeight = resolveTextBlockLineHeight(block, options.lineHeight);
  const rowCells = collectTableRowRegions(tableRegions, index);
  let nextTop = totalHeight;

  for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
    const cells = rowCells.get(rowIndex) ?? [];
    const rowHeight = Math.max(
      lineHeight + TABLE_CELL_PADDING_Y * 2,
      ...cells.map(
        ({ region }) =>
          estimateTableCellHeight(region, cellWidth, lineHeight, options.charWidth) +
          TABLE_CELL_PADDING_Y * 2,
      ),
    );
    const bottom = nextTop + rowHeight;

    for (const { index: regionIndex, region } of cells) {
      entries[regionIndex] = {
        bottom,
        top: nextTop,
      };
      containerIndices.set(region.id, regionIndex);
    }

    nextTop = bottom;
  }

  for (let regionIndex = index; regionIndex < index + tableRegions.length; regionIndex += 1) {
    const region = regions[regionIndex];

    if (!region || entries[regionIndex]) {
      continue;
    }

    entries[regionIndex] = {
      bottom: nextTop,
      top: nextTop,
    };
    containerIndices.set(region.id, regionIndex);
  }

  return {
    nextIndex: index + tableRegions.length,
    totalHeight: nextTop,
  };
}

function collectTableRowRegions(regions: DocumentIndex["regions"], startIndex: number) {
  const rows = new Map<number, Array<{ index: number; region: EditorRegion }>>();

  for (const [index, region] of regions.entries()) {
    const rowIndex = region.tableCellPosition?.rowIndex;

    if (rowIndex === undefined) {
      continue;
    }

    const current = rows.get(rowIndex) ?? [];
    current.push({
      index: startIndex + index,
      region,
    });
    rows.set(rowIndex, current);
  }

  return rows;
}

function createVirtualLayoutCacheKey(
  documentIndex: DocumentIndex,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  return [
    options.width,
    options.paddingX,
    options.paddingY,
    options.indentWidth,
    options.lineHeight,
    options.blockGap,
    resolveImageResourceSignature(documentIndex, resources),
  ].join(":");
}

function resolveImageResourceSignature(documentIndex: DocumentIndex, resources: DocumentResources) {
  // Short-circuit on documents with no image inlines. The indexer maintains
  // `imageUrls` (a set of image URLs reachable from the document); when it's
  // empty we skip a full-document inline walk on every viewport build, which
  // happens once per keystroke.
  if (documentIndex.imageUrls.size === 0) {
    return "";
  }

  return documentIndex.regions
    .flatMap((container) =>
      container.inlines
        .filter((inline) => inline.kind === "image" && inline.image)
        .map((inline) => {
          const resource = inline.image ? resources.images.get(inline.image.url) : null;
          return `${inline.image?.url ?? ""}:${inline.image?.width ?? 0}:${resource?.status ?? "loading"}:${resource?.intrinsicWidth ?? 0}:${resource?.intrinsicHeight ?? 0}`;
        }),
    )
    .join("|");
}
