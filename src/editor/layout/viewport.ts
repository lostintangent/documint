// Owns viewport-aware layout orchestration. This module estimates whole-document
// height cheaply, chooses the visible region slice, and runs exact layout only
// for that slice before shifting it into document coordinates.
import type { Block } from "@/document";
import type { DocumentResources } from "../resources";
import { emptyDocumentResources } from "../resources";
import type { DocumentEditor, DocumentEditorRegion } from "../model/document-editor";
import {
  cacheMeasuredContainerHeight,
  createCanvasRenderCache,
  getViewportPlan,
  setViewportPlan,
  type CanvasRenderCache,
  type CanvasViewportPlan,
} from "../render/cache";
import {
  buildDocumentBlockMap,
  createDocumentLayout,
  estimateLayout,
  resolveContainerGap,
  type DocumentLayoutOptions,
  type ViewportLayout,
} from "./document";
import { measureTextContainerLines, resolveTextBlockFont, resolveTextBlockLineHeight } from "./text";

export type CanvasViewport = {
  height: number;
  overscan: number;
  top: number;
};

export type DocumentViewport = {
  layout: ViewportLayout;
  totalHeight: number;
  viewport: CanvasViewport;
};

export function createDocumentViewport(
  documentEditor: DocumentEditor,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width">,
  viewport: CanvasViewport,
  pinnedContainerIds: string[] = [],
  cache = createCanvasRenderCache(),
  resources: DocumentResources = emptyDocumentResources,
): DocumentViewport {
  const blockMap = buildDocumentBlockMap(documentEditor.document.blocks);
  const runtimeBlocks = new Map(documentEditor.blocks.map((block) => [block.id, block]));
  const pinned = new Set(pinnedContainerIds);
  const expandedTop = Math.max(0, viewport.top - viewport.overscan);
  const expandedBottom = viewport.top + viewport.height + viewport.overscan;
  const plan = getOrCreateViewportPlan(cache, documentEditor, blockMap, runtimeBlocks, options, resources);
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
      layout: createDocumentLayout(
        {
          ...documentEditor,
          regions: [],
        },
        options,
        cache,
        resources,
      ),
      totalHeight: plan.totalHeight,
      viewport,
    };
  }

  const expandedSlice = expandViewportSliceToBlockBoundaries(
    documentEditor,
    runtimeBlocks,
    plan.containerIndices,
    sliceStartIndex,
    sliceEndIndex,
  );
  const sliceTop = plan.entries[expandedSlice.startIndex]?.top ?? (options.paddingY ?? 0);
  const sliceLayout = createDocumentLayout(
    {
      ...documentEditor,
      regions: documentEditor.regions.slice(
        expandedSlice.startIndex,
        expandedSlice.endIndex,
      ),
    },
    options,
    cache,
    resources,
  );
  const shiftedLayout = shiftDocumentLayout(sliceLayout, sliceTop, plan.totalHeight);

  updateMeasuredContainerHeights(cache, documentEditor, shiftedLayout, options, resources);

  return {
    layout: shiftedLayout,
    totalHeight: plan.totalHeight,
    viewport,
  };
}

function updateMeasuredContainerHeights(
  cache: CanvasRenderCache,
  documentEditor: DocumentEditor,
  layout: ViewportLayout,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width">,
  resources: DocumentResources,
) {
  for (const [regionId, extent] of layout.regionExtents) {
    const height = extent.bottom - extent.top;
    const container = documentEditor.regionIndex.get(regionId);

    cacheMeasuredContainerHeight(
      cache,
      createContainerHeightCacheKey(container ?? { id: regionId, runs: [] }, options, resources),
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
    regionExtents: new Map(
      [...layout.regionExtents.entries()].map(([regionId, extent]) => [
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
  documentEditor: DocumentEditor,
  runtimeBlocks: Map<string, DocumentEditor["blocks"][number]>,
  containerIndices: Map<string, number>,
  startIndex: number,
  endIndex: number,
) {
  let nextStartIndex = startIndex;
  let nextEndIndex = endIndex;

  for (let index = startIndex; index < endIndex; index += 1) {
    const container = documentEditor.regions[index]!;
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
  container: DocumentEditorRegion,
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

  if (container.runs.some((run) => run.kind === "image")) {
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
  documentEditor: DocumentEditor,
  blockMap: Map<string, Block>,
  runtimeBlocks: Map<string, DocumentEditor["blocks"][number]>,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width">,
  resources: DocumentResources,
) {
  const cacheKey = createViewportPlanCacheKey(documentEditor, options, resources);
  const cached = getViewportPlan(cache, documentEditor, cacheKey);

  if (cached) {
    return cached;
  }

  let totalHeight = options.paddingY ?? 0;
  const entries: CanvasViewportPlan["entries"] = [];
  const containerIndices = new Map<string, number>();

  for (let index = 0; index < documentEditor.regions.length; index += 1) {
    const container = documentEditor.regions[index]!;
    const block = blockMap.get(container.blockId) ?? null;
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
        documentEditor.regions,
        index,
        options.blockGap ?? 16,
      );
  }

  return setViewportPlan(cache, documentEditor, cacheKey, {
    containerIndices,
    entries,
    totalHeight,
  });
}

function createViewportPlanCacheKey(
  documentEditor: DocumentEditor,
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
    resolveImageResourceSignature(documentEditor, resources),
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
  container: Pick<DocumentEditorRegion, "id" | "runs">,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width">,
  resources: DocumentResources,
) {
  const imageSignature = container.runs
    .filter((run) => run.kind === "image" && run.image)
    .map((run) => {
      const resource = run.image ? resources.images.get(run.image.url) : null;
      return `${run.image?.url ?? ""}:${run.image?.width ?? 0}:${resource?.status ?? "loading"}:${resource?.intrinsicWidth ?? 0}:${resource?.intrinsicHeight ?? 0}`;
    })
    .join("|");

  return `${container.id}:${options.width}:${options.paddingX ?? 0}:${options.indentWidth ?? 24}:${options.lineHeight ?? 24}:${imageSignature}`;
}

function resolveImageResourceSignature(
  documentEditor: DocumentEditor,
  resources: DocumentResources,
) {
  return documentEditor.regions
    .flatMap((container) =>
      container.runs
        .filter((run) => run.kind === "image" && run.image)
        .map((run) => {
          const resource = run.image ? resources.images.get(run.image.url) : null;
          return `${run.image?.url ?? ""}:${run.image?.width ?? 0}:${resource?.status ?? "loading"}:${resource?.intrinsicWidth ?? 0}:${resource?.intrinsicHeight ?? 0}`;
        }),
    )
    .join("|");
}
