// Owns construction and caching of the whole-document virtual layout estimate.
// The virtual layout mirrors exact block walking, but stores only estimated
// path bounds and total document height.

import type { DocumentResources } from "@/types";
import { resolveResourceProtocol, type Block } from "@/document";
import { createResourceIconSignature } from "@/editor/resources";
import type { DocumentIndex, IndexedBlock } from "../../state";
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
  resolveTableColumnMetrics,
  resolveTableRowHeight,
} from "../measure/table";
import { resolveTextBlockLineHeight } from "../measure/text";
import { resolveBlockLayoutTextInput, tableCellLayoutTextInput } from "../measure/text-input";
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
  // blocks contribute fixed height to `totalHeight` so subsequent paths land
  // at Y positions consistent with exact layout. They have no virtual-layout
  // entry. Container blocks (blockquote, list, listItem) are skipped here just
  // as in layout — their leaf descendants emit the actual entries.
  let totalHeight = options.paddingY;
  const entries: VirtualLayout["entries"] = [];
  const pathIndices = new Map<string, number>();

  for (const {
    gapBefore,
    indexedBlock,
    isInert,
  } of walkLayoutBlocks(documentIndex, { blockGap: options.blockGap })) {
    const block = indexedBlock.block;

    totalHeight += gapBefore;

    if (isInert) {
      totalHeight += options.lineHeight;
    } else if (block.type === "table") {
      const result = appendTableEstimateEntries({
        block,
        depth: indexedBlock.depth,
        entries,
        indexedBlock,
        options,
        pathIndices,
        totalHeight,
      });
      if (result) {
        totalHeight = result.totalHeight;
      }
    } else {
      const contentMetrics = resolveBlockContentMetrics(documentIndex, indexedBlock, options);
      const input = resolveBlockLayoutTextInput(indexedBlock);

      if (input) {
        const estimatedHeight = estimateContainerHeight(
          cache,
          input,
          block,
          contentMetrics,
          options,
          resources,
        );
        const top = totalHeight;
        const bottom = top + estimatedHeight;
        appendEstimateEntry(entries, pathIndices, {
          blockArrayIndex: indexedBlock.blockArrayIndex,
          bottom,
          path: input.path,
          top,
        });
        totalHeight = bottom;
      }
    }
  }

  return setVirtualLayout(cache, documentIndex, cacheKey, {
    entries,
    pathIndices,
    estimatePathBounds(path) {
      const index = pathIndices.get(path);
      const entry = index === undefined ? null : (entries[index] ?? null);

      return entry ? { bottom: entry.bottom, top: entry.top } : null;
    },
    totalHeight,
  });
}

function appendTableEstimateEntries({
  block,
  depth,
  entries,
  indexedBlock,
  options,
  pathIndices,
  totalHeight,
}: {
  block: Extract<Block, { type: "table" }>;
  depth: number;
  entries: VirtualLayout["entries"];
  indexedBlock: IndexedBlock;
  options: DocumentLayoutOptions;
  pathIndices: Map<string, number>;
  totalHeight: number;
}) {
  if (indexedBlock.kind !== "cells") {
    return null;
  }

  const left = options.paddingX + depth * options.indentWidth;
  const { cellWidth } = resolveTableColumnMetrics(block, left, options);
  const lineHeight = resolveTextBlockLineHeight(block, options.lineHeight, options.fontSize);
  let nextTop = totalHeight;

  for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
    const cells = indexedBlock.tableCellRows[rowIndex] ?? [];
    const inputs = cells.map(tableCellLayoutTextInput);
    const rowHeight = resolveTableRowHeight(
      lineHeight,
      inputs.map((input) =>
        estimateTableCellHeight(input, cellWidth, lineHeight, options.charWidth),
      ),
    );
    const bottom = nextTop + rowHeight;

    for (const input of inputs) {
      appendEstimateEntry(entries, pathIndices, {
        blockArrayIndex: indexedBlock.blockArrayIndex,
        bottom,
        path: input.path,
        top: nextTop,
      });
    }

    nextTop = bottom;
  }

  return {
    totalHeight: nextTop,
  };
}

function appendEstimateEntry(
  entries: VirtualLayout["entries"],
  pathIndices: Map<string, number>,
  entry: VirtualLayout["entries"][number],
) {
  const index = entries.length;
  entries.push(entry);
  pathIndices.set(entry.path, index);
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
