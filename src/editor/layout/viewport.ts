// Owns viewport-aware layout orchestration. This module estimates whole-document
// height cheaply, chooses the visible region slice, and runs exact layout only
// for that slice before shifting it into document coordinates. The planner can
// tolerate cheap text underestimation within overscan, but structural
// overestimation is dangerous because it can stop the exact viewport slice
// before content that should be visible.
import type { Block } from "@/document";
import type { DocumentResources } from "@/types";
import type { DocumentIndex, EditorRegion } from "../state";
import {
  cacheMeasuredContainerHeight,
  createCanvasRenderCache,
  getViewportPlan,
  setViewportPlan,
  type CanvasRenderCache,
  type CanvasViewportPlan,
} from "../canvas/cache";
import {
  buildDocumentBlockMap,
  createDocumentLayout,
  estimateLayout,
  resolveContainerGap,
  type DocumentLayoutOptions,
  type ViewportLayout,
} from "./document";
import { TABLE_CELL_PADDING_X, TABLE_CELL_PADDING_Y, TABLE_MIN_WIDTH } from "./table";
import {
  measureTextContainerLines,
  resolveRegionMeasurementCacheIdentity,
  resolveTextBlockFont,
  resolveTextBlockLineHeight,
} from "./text";

export type CanvasViewport = {
  height: number;
  overscan: number;
  top: number;
};

export type DocumentViewport = {
  estimateRegionBounds: (regionId: string) => { bottom: number; top: number } | null;
  layout: ViewportLayout;
  totalHeight: number;
  viewport: CanvasViewport;
};

export function createDocumentViewport(
  documentIndex: DocumentIndex,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width">,
  viewport: CanvasViewport,
  pinnedContainerIds: string[] = [],
  cache = createCanvasRenderCache(),
  resources: DocumentResources | null = null,
): DocumentViewport {
  const resolvedResources: DocumentResources = resources ?? { images: new Map() };
  const blockMap = buildDocumentBlockMap(documentIndex.document.blocks);
  const runtimeBlocks = new Map(documentIndex.blocks.map((block) => [block.id, block]));
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

function updateMeasuredContainerHeights(
  cache: CanvasRenderCache,
  documentIndex: DocumentIndex,
  layout: ViewportLayout,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width">,
  resources: DocumentResources,
) {
  for (const [regionId, extent] of layout.regionBounds) {
    const height = extent.bottom - extent.top;
    const container = documentIndex.regionIndex.get(regionId);

    cacheMeasuredContainerHeight(
      cache,
      createContainerHeightCacheKey(
        container ?? { path: regionId, inlines: [], text: "" },
        options,
        resources,
      ),
      height,
    );
  }
}

function shiftDocumentLayout(
  layout: ViewportLayout,
  topOffset: number,
  totalHeight: number,
): ViewportLayout {
  return {
    ...layout,
    blocks: layout.blocks.map((block) => ({
      ...block,
      bottom: block.bottom + topOffset,
      top: block.top + topOffset,
    })),
    regionBounds: new Map(
      [...layout.regionBounds.entries()].map(([regionId, extent]) => [
        regionId,
        {
          bottom: extent.bottom + topOffset,
          left: extent.left,
          right: extent.right,
          top: extent.top + topOffset,
        },
      ]),
    ),
    height: totalHeight,
    lines: layout.lines.map((line) => ({
      ...line,
      top: line.top + topOffset,
    })),
  };
}

function expandViewportSliceToBlockBoundaries(
  documentIndex: DocumentIndex,
  runtimeBlocks: Map<string, DocumentIndex["blocks"][number]>,
  containerIndices: Map<string, number>,
  startIndex: number,
  endIndex: number,
) {
  let nextStartIndex = startIndex;
  let nextEndIndex = endIndex;

  for (let index = startIndex; index < endIndex; index += 1) {
    const container = documentIndex.regions[index]!;
    const block = runtimeBlocks.get(container.blockId);

    if (!block) {
      continue;
    }

    if (block.type === "table") {
      const firstIndex = containerIndices.get(block.regionIds[0] ?? "");
      const lastIndex = containerIndices.get(block.regionIds[block.regionIds.length - 1] ?? "");

      if (firstIndex !== undefined) {
        nextStartIndex = Math.min(nextStartIndex, firstIndex);
      }

      if (lastIndex !== undefined) {
        nextEndIndex = Math.max(nextEndIndex, lastIndex + 1);
      }
    }
  }

  return {
    endIndex: nextEndIndex,
    startIndex: nextStartIndex,
  };
}

function estimateContainerHeight(
  cache: CanvasRenderCache,
  container: EditorRegion,
  block: Block | null,
  depth: number,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width">,
  resources: DocumentResources,
) {
  const cacheKey = createContainerHeightCacheKey(container, options, resources);
  const cached = cache.measuredContainerHeights.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const paddingX = options.paddingX ?? 0;
  const indentWidth = options.indentWidth ?? 24;
  const lineHeight = resolveTextBlockLineHeight(block, options.lineHeight ?? 24);
  const left = paddingX + depth * indentWidth;
  const availableWidth = Math.max(40, options.width - left - paddingX);

  if (container.inlines.some((run) => run.kind === "image")) {
    const font = resolveTextBlockFont(block);
    return measureTextContainerLines(
      cache,
      container,
      font,
      block,
      availableWidth,
      lineHeight,
      resources,
    ).reduce((total, line) => total + line.height, 0);
  }

  const estimate = estimateLayout({
    text: container.text,
    width: availableWidth,
  });
  const estimatedHeight = Math.max(lineHeight, estimate.lineCount * lineHeight);

  return estimatedHeight;
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

  let totalHeight = options.paddingY ?? 0;
  const entries: CanvasViewportPlan["entries"] = [];
  const containerIndices = new Map<string, number>();

  for (let index = 0; index < documentIndex.regions.length; index += 1) {
    const container = documentIndex.regions[index]!;
    const block = blockMap.get(container.blockId) ?? null;

    if (block?.type === "table") {
      const result = appendTablePlanEntries({
        block,
        blockMap,
        containerIndices,
        entries,
        index,
        options,
        runtimeBlocks,
        totalHeight,
        regions: documentIndex.regions,
      });

      if (result) {
        index = result.nextIndex - 1;
        totalHeight = result.totalHeight;
        continue;
      }
    }

    const estimatedHeight = estimateContainerHeight(
      cache,
      container,
      block,
      runtimeBlocks.get(container.blockId)?.depth ?? 0,
      options,
      resources,
    );
    const top = totalHeight;
    const bottom = top + estimatedHeight;

    entries.push({
      bottom,
      top,
    });
    containerIndices.set(container.id, index);
    totalHeight =
      bottom +
      resolveContainerGap(
        runtimeBlocks,
        blockMap,
        documentIndex.regions,
        index,
        options.blockGap ?? 16,
      );
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
  blockMap,
  containerIndices,
  entries,
  index,
  options,
  runtimeBlocks,
  totalHeight,
  regions,
}: {
  block: Extract<Block, { type: "table" }>;
  blockMap: Map<string, Block>;
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
          estimateTableCellHeight(region, cellWidth, lineHeight) + TABLE_CELL_PADDING_Y * 2,
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
    totalHeight:
      nextTop +
      resolveContainerGap(
        runtimeBlocks,
        blockMap,
        regions,
        index + tableRegions.length - 1,
        options.blockGap ?? 16,
      ),
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

function estimateTableCellHeight(region: EditorRegion, width: number, lineHeight: number) {
  const estimate = estimateLayout({
    text: region.text,
    width,
  });

  return Math.max(lineHeight, estimate.lineCount * lineHeight);
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

function findViewportPlanEntryIndexAtOrAfter(plan: CanvasViewportPlan, y: number) {
  let low = 0;
  let high = plan.entries.length;

  while (low < high) {
    const middle = (low + high) >> 1;
    const entry = plan.entries[middle]!;

    if (entry.bottom <= y) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function createContainerHeightCacheKey(
  container: Pick<EditorRegion, "path" | "inlines" | "text">,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width">,
  resources: DocumentResources,
) {
  return `${resolveRegionMeasurementCacheIdentity(container, resources)}:${options.width}:${options.paddingX ?? 0}:${options.indentWidth ?? 24}:${options.lineHeight ?? 24}`;
}

function resolveImageResourceSignature(documentIndex: DocumentIndex, resources: DocumentResources) {
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
