// Owns large-document slice picking and post-exact processing: find the visible
// window in estimate space, expand it so tables stay whole, and feed measured
// heights back into the cache so subsequent estimates use real numbers for
// visible paths. The slice is measured directly in document space (via
// `measureBodyLayoutSlice`'s `startY`), so no coordinate shift is needed here.

import type { DocumentResources } from "@/editor/resources";
import { resolveIndexedBlock, type DocumentIndex } from "../../state";
import type { LayoutCache, VirtualLayout } from "../state/cache";
import { resolveBlockPaddingY } from "../lib/code-block";
import { resolveBlockContentMetrics, resolveBlockSurfaceLeft } from "../lib/content-metrics";
import type { DocumentLayoutOptions } from "../lib/options";
import type { DocumentLayout } from "../measure";
import { resolveTableColumnMetrics } from "../measure/table";
import {
  resolveBlockTypography,
  type BlockTypography,
  type LayoutTextInput,
} from "../measure/text";
import { resolveBlockLayoutTextInput, tableCellLayoutTextInput } from "../measure/text-input";
import { cacheMeasuredHeight } from "./height-estimate";

// Widens an entry range to whole blocks so a table is never measured in part.
// Entries are in block order, and only tables own more than one.
export function expandViewportSliceToBlockBoundaries(
  documentIndex: DocumentIndex,
  { entries }: VirtualLayout,
  startIndex: number,
  endIndex: number,
) {
  if (startIndex >= endIndex) {
    return {
      blockEndIndex: 0,
      blockStartIndex: 0,
      entryEndIndex: 0,
      entryStartIndex: 0,
      top: null,
    };
  }

  const blockStartIndex = entries[startIndex]!.blockArrayIndex;
  const lastBlockIndex = entries[endIndex - 1]!.blockArrayIndex;
  let entryStartIndex = startIndex;
  let entryEndIndex = endIndex;

  while (entryStartIndex > 0 && entries[entryStartIndex - 1]!.blockArrayIndex === blockStartIndex) {
    entryStartIndex -= 1;
  }

  while (
    entryEndIndex < entries.length &&
    entries[entryEndIndex]!.blockArrayIndex === lastBlockIndex
  ) {
    entryEndIndex += 1;
  }

  // Entries hold path bounds, so step back over the block's padding to seed
  // measurement where the block itself starts.
  return {
    blockEndIndex: documentIndex.blocks[lastBlockIndex]!.blockRangeEnd,
    blockStartIndex,
    entryEndIndex,
    entryStartIndex,
    top:
      entries[entryStartIndex]!.top -
      resolveBlockPaddingY(documentIndex.blocks[blockStartIndex]!.block),
  };
}

// Caches every measured container's content height under the same key its
// estimate reads, so later estimates, including rebuilds after an edit, reuse
// real numbers. Table cells are cached one by one, and a row re-resolves as the
// tallest of them, exactly as `layoutTable` does.
export function updateMeasuredContainerHeights(
  cache: LayoutCache,
  documentIndex: DocumentIndex,
  layout: DocumentLayout,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  for (const { blockPath } of layout.blocks) {
    const indexedBlock = resolveIndexedBlock(documentIndex, blockPath);

    if (!indexedBlock) continue;

    const { block } = indexedBlock;
    const typography = resolveBlockTypography(block, options.fontSize, options.lineHeight);

    if (block.type === "table") {
      if (indexedBlock.kind !== "cells") continue;

      const left = resolveBlockSurfaceLeft(documentIndex, indexedBlock, options);
      const { cellWidth } = resolveTableColumnMetrics(block, left, options);

      for (const cells of indexedBlock.tableCellRows) {
        for (const cell of cells) {
          cacheMeasuredContainer(
            cache,
            layout,
            tableCellLayoutTextInput(cell),
            cellWidth,
            typography,
            resources,
          );
        }
      }
    } else {
      const input = resolveBlockLayoutTextInput(indexedBlock);

      if (input) {
        cacheMeasuredContainer(
          cache,
          layout,
          input,
          resolveBlockContentMetrics(documentIndex, indexedBlock, options).availableWidth,
          typography,
          resources,
        );
      }
    }
  }
}

// A container's content height is the sum of its line heights. Table cells
// can't use their path bounds, which span the whole row.
function cacheMeasuredContainer(
  cache: LayoutCache,
  layout: DocumentLayout,
  input: LayoutTextInput,
  availableWidth: number,
  typography: BlockTypography,
  resources: DocumentResources,
) {
  const lineIndices = layout.pathLineIndices.get(input.path);

  if (!lineIndices) return;

  let height = 0;

  for (const index of lineIndices) {
    height += layout.lines[index]!.height;
  }

  cacheMeasuredHeight(cache, input, availableWidth, typography, resources, height);
}
