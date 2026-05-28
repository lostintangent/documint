// Owns construction and caching of the whole-document virtual layout estimate.
// The virtual layout mirrors exact block walking, but stores only estimated
// region bounds and total document height.

import type { Block } from "@/document";
import type { DocumentResources } from "@/types";
import { createResourceIconSignature, resolveResourceProtocol } from "@/resources";
import { isContainerBlock, isInertBlock } from "../../state/index/query";
import type { DocumentIndex, EditableRegion } from "../../state";
import {
  getVirtualLayout,
  setVirtualLayout,
  type LayoutCache,
  type VirtualLayout,
} from "../state/cache";
import { resolveListMarkerInset } from "../lib/marker-metrics";
import type { DocumentLayoutOptions } from "../lib/options";
import { resolveBlockGap } from "../lib/block-spacing";
import { TABLE_CELL_PADDING_X, TABLE_CELL_PADDING_Y, TABLE_MIN_WIDTH } from "../measure/table";
import { resolveTextBlockLineHeight } from "../measure/text";
import { estimateContainerHeight, estimateTableCellHeight } from "./height-estimate";

export function getOrCreateVirtualLayout(
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

  for (const indexedBlock of documentIndex.blocks) {
    const block = blockMap.get(indexedBlock.block.id) ?? null;
    if (!block || isContainerBlock(indexedBlock)) continue;

    const isInert = isInertBlock(indexedBlock);
    if (!isInert && indexedBlock.regionIds.length === 0) continue;

    if (previousLaidOutBlockId !== null) {
      totalHeight += resolveBlockGap(
        runtimeBlocks,
        blockMap,
        previousLaidOutBlockId,
        indexedBlock.block.id,
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
      const listInset = resolveListMarkerInset(documentIndex, indexedBlock.block.id);
      for (const _regionId of indexedBlock.regionIds) {
        const container = documentIndex.regions[regionCursor];
        if (!container) {
          regionCursor += 1;
          continue;
        }
        const estimatedHeight = estimateContainerHeight(
          cache,
          container,
          block,
          indexedBlock.depth,
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

    previousLaidOutBlockId = indexedBlock.block.id;
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

  if (tableRegions.length === 0 || tableRegions[0]?.block.id !== block.id) {
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
  const rows = new Map<number, Array<{ index: number; region: EditableRegion }>>();

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
