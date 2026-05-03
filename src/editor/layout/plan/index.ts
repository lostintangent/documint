// Owns viewport-aware layout orchestration. This module estimates whole-document
// height cheaply, chooses the visible region slice, and runs exact layout only
// for that slice before shifting it into document coordinates. The planner can
// tolerate cheap text underestimation within overscan, but structural
// overestimation is dangerous because it can stop the exact viewport slice
// before content that should be visible.
import type { Block } from "@/document";
import type { DocumentResources } from "@/types";
import {
  isContainerBlock,
  isInertBlock,
  type DocumentIndex,
  type EditorRegion,
} from "../../state";
import {
  createCanvasRenderCache,
  getViewportPlan,
  setViewportPlan,
  type CanvasRenderCache,
  type CanvasViewportPlan,
} from "../../canvas/lib/cache";
import type { DocumentLayoutOptions } from "../lib/options";
import { resolveLeafBlockGap } from "../lib/spacing";
import {
  buildDocumentBlockMap,
  createDocumentLayout,
  type DocumentLayout,
} from "../measure";
import { TABLE_CELL_PADDING_X, TABLE_CELL_PADDING_Y, TABLE_MIN_WIDTH } from "../measure/table";
import { resolveTextBlockLineHeight } from "../measure/text";
import { estimateContainerHeight, estimateTableCellHeight } from "./estimate";
import {
  expandViewportSliceToBlockBoundaries,
  findViewportPlanEntryIndexAtOrAfter,
  shiftDocumentLayout,
  updateMeasuredContainerHeights,
} from "./slice";

export type CanvasViewport = {
  height: number;
  overscan: number;
  top: number;
};

export type ViewportLayout = {
  estimateRegionBounds: (regionId: string) => { bottom: number; top: number } | null;
  layout: DocumentLayout;
  totalHeight: number;
  viewport: CanvasViewport;
};

export function createViewportLayout(
  documentIndex: DocumentIndex,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width">,
  viewport: CanvasViewport,
  pinnedContainerIds: string[] = [],
  cache = createCanvasRenderCache(),
  resources: DocumentResources | null = null,
): ViewportLayout {
  const resolvedResources: DocumentResources = resources ?? { images: new Map() };
  const blockMap = buildDocumentBlockMap(documentIndex.document.blocks);
  // documentIndex.blockIndex is already `Map<string, EditorBlock>` keyed by
  // block id — exactly what we need. Reusing it skips a per-call O(N) Map
  // rebuild that contributed measurable cost on long-doc keystrokes.
  const runtimeBlocks = documentIndex.blockIndex;
  const pinned = new Set(pinnedContainerIds);
  const expandedTop = Math.max(0, viewport.top - viewport.overscan);
  const expandedBottom = viewport.top + viewport.height + viewport.overscan;
  const plan = getOrCreateViewportPlan(
    cache,
    documentIndex,
    blockMap,
    runtimeBlocks,
    options,
    resolvedResources,
  );
  let sliceStartIndex = findViewportPlanEntryIndexAtOrAfter(plan, expandedTop);
  let sliceEndIndex = findViewportPlanEntryIndexAtOrAfter(plan, expandedBottom);

  if (sliceStartIndex > 0) {
    const previous = plan.entries[sliceStartIndex - 1];

    if (previous && previous.bottom > expandedTop) {
      sliceStartIndex -= 1;
    }
  }

  if (sliceEndIndex < plan.entries.length) {
    const next = plan.entries[sliceEndIndex];

    if (next && next.top < expandedBottom) {
      sliceEndIndex += 1;
    }
  }

  for (const regionId of pinned) {
    const index = plan.containerIndices.get(regionId);

    if (index === undefined) {
      continue;
    }

    sliceStartIndex = Math.min(sliceStartIndex, index);
    sliceEndIndex = Math.max(sliceEndIndex, index + 1);
  }

  if (!Number.isFinite(sliceStartIndex) || !Number.isFinite(sliceEndIndex)) {
    return {
      estimateRegionBounds: plan.estimateRegionBounds,
      layout: createDocumentLayout(
        {
          ...documentIndex,
          regions: [],
        },
        options,
        cache,
        resolvedResources,
      ),
      totalHeight: plan.totalHeight,
      viewport,
    };
  }

  const expandedSlice = expandViewportSliceToBlockBoundaries(
    documentIndex,
    runtimeBlocks,
    plan.containerIndices,
    sliceStartIndex,
    sliceEndIndex,
  );
  const sliceTop = plan.entries[expandedSlice.startIndex]?.top ?? options.paddingY ?? 0;
  const sliceLayout = createDocumentLayout(
    {
      ...documentIndex,
      regions: documentIndex.regions.slice(expandedSlice.startIndex, expandedSlice.endIndex),
    },
    options,
    cache,
    resolvedResources,
  );
  const shiftedLayout = shiftDocumentLayout(sliceLayout, sliceTop, plan.totalHeight);

  updateMeasuredContainerHeights(cache, documentIndex, shiftedLayout, options, resolvedResources);

  return {
    estimateRegionBounds: plan.estimateRegionBounds,
    layout: shiftedLayout,
    totalHeight: plan.totalHeight,
    viewport,
  };
}

function getOrCreateViewportPlan(
  cache: CanvasRenderCache,
  documentIndex: DocumentIndex,
  blockMap: Map<string, Block>,
  runtimeBlocks: Map<string, DocumentIndex["blocks"][number]>,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width">,
  resources: DocumentResources,
) {
  const cacheKey = createViewportPlanCacheKey(documentIndex, options, resources);
  const cached = getViewportPlan(cache, documentIndex, cacheKey);

  if (cached) {
    return cached;
  }

  // Plan walks blocks (mirroring `createDocumentLayout`). Inert leaf
  // blocks contribute fixed height to `totalHeight` so subsequent regions
  // land at Y positions consistent with what layout actually produces.
  // They have no plan entry — the entries array stays 1:1 with
  // `documentIndex.regions`. Container blocks (blockquote, list,
  // listItem) are skipped here just as in layout — their leaf descendants
  // emit the actual entries.
  const blockGap = options.blockGap ?? 16;
  const lineHeight = options.lineHeight ?? 24;
  let totalHeight = options.paddingY ?? 0;
  // Sparse array — entries[i] corresponds to documentIndex.regions[i]; slots
  // for inert leaves (which have no region) are never written.
  const entries: CanvasViewportPlan["entries"] = [];
  const containerIndices = new Map<string, number>();
  let regionCursor = 0;
  let previousLaidOutBlockId: string | null = null;

  for (const blockEntry of documentIndex.blocks) {
    const block = blockMap.get(blockEntry.id) ?? null;
    if (!block || isContainerBlock(block)) continue;

    const isInert = isInertBlock(blockEntry);
    if (!isInert && blockEntry.regionIds.length === 0) continue;

    if (previousLaidOutBlockId !== null) {
      totalHeight += resolveLeafBlockGap(
        runtimeBlocks,
        blockMap,
        previousLaidOutBlockId,
        blockEntry.id,
        blockGap,
      );
    }

    if (isInert) {
      totalHeight += lineHeight;
    } else if (block.type === "table") {
      const result = appendTablePlanEntries({
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

  return setViewportPlan(cache, documentIndex, cacheKey, {
    containerIndices,
    entries,
    estimateRegionBounds(regionId) {
      const index = containerIndices.get(regionId);

      return index === undefined ? null : (entries[index] ?? null);
    },
    totalHeight,
  });
}

function appendTablePlanEntries({
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
  entries: CanvasViewportPlan["entries"];
  index: number;
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width">;
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

  const paddingX = options.paddingX ?? 0;
  const indentWidth = options.indentWidth ?? 24;
  const depth = runtimeBlock?.depth ?? 0;
  const left = paddingX + depth * indentWidth;
  const tableWidth = Math.max(TABLE_MIN_WIDTH, options.width - left - paddingX);
  const columnCount = Math.max(1, ...block.rows.map((row) => row.cells.length));
  const columnWidth = tableWidth / columnCount;
  const cellWidth = Math.max(40, columnWidth - TABLE_CELL_PADDING_X * 2);
  const lineHeight = resolveTextBlockLineHeight(block, options.lineHeight ?? 24);
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

function createViewportPlanCacheKey(
  documentIndex: DocumentIndex,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width">,
  resources: DocumentResources,
) {
  return [
    options.width,
    options.paddingX ?? 0,
    options.paddingY ?? 0,
    options.indentWidth ?? 24,
    options.lineHeight ?? 24,
    options.blockGap ?? 16,
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
        .filter((run) => run.kind === "image" && run.image)
        .map((run) => {
          const resource = run.image ? resources.images.get(run.image.url) : null;
          return `${run.image?.url ?? ""}:${run.image?.width ?? 0}:${resource?.status ?? "loading"}:${resource?.intrinsicWidth ?? 0}:${resource?.intrinsicHeight ?? 0}`;
        }),
    )
    .join("|");
}
