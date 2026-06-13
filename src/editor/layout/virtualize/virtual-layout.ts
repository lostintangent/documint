// Owns construction and caching of the whole-document virtual layout estimate.
// The virtual layout mirrors exact block walking, but stores only estimated
// region bounds and total document height.

import type { DocumentResources } from "@/types";
import { resolveResourceProtocol, type Block } from "@/document";
import { createResourceIconSignature } from "@/editor/resources";
import type { DocumentIndex } from "../../state";
import {
  getVirtualLayout,
  setVirtualLayout,
  type LayoutCache,
  type VirtualLayout,
} from "../state/cache";
import { walkLayoutBlocks } from "../lib/block-walk";
import { resolveBlockContentMetrics } from "../lib/content-metrics";
import type { DocumentLayoutOptions } from "../lib/options";
import {
  groupTableRegionsByRow,
  resolveTableColumnMetrics,
  resolveTableRowHeight,
} from "../measure/table";
import { resolveTextBlockLineHeight } from "../measure/text";
import { estimateContainerHeight, estimateTableCellHeight } from "./height-estimate";

export function getOrCreateVirtualLayout(
  cache: LayoutCache,
  documentIndex: DocumentIndex,
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

  for (const { blockRegionsInScope, gapBefore, indexedBlock, isInert } of walkLayoutBlocks(
    documentIndex,
    { blockGap: options.blockGap },
  )) {
    const block = indexedBlock.block;

    totalHeight += gapBefore;

    if (isInert) {
      totalHeight += options.lineHeight;
    } else if (block.type === "table") {
      const result = appendTableEstimateEntries({
        block,
        indexedBlock,
        containerIndices,
        entries,
        index: regionCursor,
        options,
        totalHeight,
        regions: documentIndex.regions,
      });
      if (result) {
        regionCursor = result.nextIndex;
        totalHeight = result.totalHeight;
      }
    } else {
      const contentMetrics = resolveBlockContentMetrics(documentIndex, indexedBlock, options);
      for (const _regionId of blockRegionsInScope) {
        const container = documentIndex.regions[regionCursor];
        if (!container) {
          regionCursor += 1;
          continue;
        }
        const estimatedHeight = estimateContainerHeight(
          cache,
          container,
          block,
          contentMetrics,
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
  indexedBlock,
  containerIndices,
  entries,
  index,
  options,
  totalHeight,
  regions,
}: {
  block: Extract<Block, { type: "table" }>;
  indexedBlock: DocumentIndex["blocks"][number];
  containerIndices: Map<string, number>;
  entries: VirtualLayout["entries"];
  index: number;
  options: DocumentLayoutOptions;
  totalHeight: number;
  regions: DocumentIndex["regions"];
}) {
  const tableRegionIds = indexedBlock.regionIds;

  if (tableRegionIds.length === 0) {
    return null;
  }

  const tableRegions = regions.slice(index, index + tableRegionIds.length);

  if (tableRegions.length === 0 || tableRegions[0]?.block.id !== block.id) {
    return null;
  }

  const depth = indexedBlock.depth;
  const left = options.paddingX + depth * options.indentWidth;
  const { cellWidth } = resolveTableColumnMetrics(block, left, options);
  const lineHeight = resolveTextBlockLineHeight(block, options.lineHeight, options.fontSize);
  const rowCells = collectTableRowRegions(tableRegions, index);
  let nextTop = totalHeight;

  for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
    const cells = rowCells.get(rowIndex) ?? [];
    const rowHeight = resolveTableRowHeight(
      lineHeight,
      cells.map(({ region }) =>
        estimateTableCellHeight(region, cellWidth, lineHeight, options.charWidth),
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
  return groupTableRegionsByRow(regions, (region, index) => ({
    index: startIndex + index,
    region,
  }));
}

function createVirtualLayoutCacheKey(
  documentIndex: DocumentIndex,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  // fontSize is keyed alongside lineHeight: an embedder that supplies an
  // explicit lineHeight decouples the two, and a fontSize change there
  // would otherwise reuse stale entries (heading sizes, code font, inline
  // code metrics all shift with fontSize but not with lineHeight).
  return [
    options.width,
    options.paddingX,
    options.paddingY,
    options.indentWidth,
    options.fontSize,
    options.lineHeight,
    options.blockGap,
    resolveImageResourceSignature(documentIndex, resources),
    resolveResourceSignature(documentIndex, resources),
  ].join(":");
}

function resolveImageResourceSignature(documentIndex: DocumentIndex, resources: DocumentResources) {
  if (documentIndex.imageUrls.size === 0) {
    return "";
  }

  // The virtual-layout cache is scoped by `DocumentIndex`, so authored image
  // dimensions are already captured by the weak-map key. The cache key only
  // needs the mutable resource facts that can change while the document index
  // stays the same.
  let signature = "";

  for (const url of documentIndex.imageUrls) {
    const resource = resources.images.get(url);
    if (signature) {
      signature += "|";
    }
    signature += `${url}:${resource?.status ?? "loading"}:${resource?.intrinsicWidth ?? 0}:${resource?.intrinsicHeight ?? 0}`;
  }

  return signature;
}

function resolveResourceSignature(documentIndex: DocumentIndex, resources: DocumentResources) {
  if (documentIndex.resourceUrls.size === 0 || resources.resourceRegistry.protocols.size === 0) {
    return "";
  }

  let signature = "";

  for (const url of documentIndex.resourceUrls) {
    const protocol = resolveResourceProtocol(url) ?? "";
    const protocolSpec = resources.resourceRegistry.protocols.get(protocol);

    if (!protocolSpec) {
      continue;
    }

    if (signature) {
      signature += "|";
    }
    signature += `${url}:${createResourceIconSignature(protocolSpec.icon)}:${protocolSpec.label}`;
  }

  return signature;
}
