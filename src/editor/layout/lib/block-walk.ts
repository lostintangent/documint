// Owns the leaf-block walk shared by exact layout and virtual height estimation.

import {
  isContainerBlock,
  isInertBlock,
  type DocumentIndex,
} from "../../state";
import { resolveBlockGap } from "./block-spacing";

export type LayoutBlockWalkEntry = {
  gapBefore: number;
  indexedBlock: DocumentIndex["blocks"][number];
  isInert: boolean;
  previousLaidOutBlock: DocumentIndex["blocks"][number] | null;
  previousLaidOutBlockIsInert: boolean;
  regionEndIndex: number;
  regionStartIndex: number;
};

export function* walkLayoutBlocks(
  documentIndex: DocumentIndex,
  {
    blockGap,
    layoutBlocks = documentIndex.blocks,
    visibleRegionEndIndex = documentIndex.regions.length,
    visibleRegionStartIndex = 0,
  }: {
    blockGap: number;
    layoutBlocks?: DocumentIndex["blocks"];
    visibleRegionEndIndex?: number;
    visibleRegionStartIndex?: number;
  },
): Generator<LayoutBlockWalkEntry> {
  let previousLaidOutBlock: DocumentIndex["blocks"][number] | null = null;

  for (const indexedBlock of layoutBlocks) {
    if (isContainerBlock(indexedBlock)) continue;

    const isInert = isInertBlock(indexedBlock);
    const regionStartIndex = Math.max(indexedBlock.regionRangeStart, visibleRegionStartIndex);
    const regionEndIndex = Math.min(indexedBlock.regionRangeEnd, visibleRegionEndIndex);

    // Skip text/table blocks whose regions are outside this walk. Inert leaves
    // still lay out because they reserve block-flow height without regions.
    if (!isInert && regionStartIndex >= regionEndIndex) continue;

    yield {
      gapBefore:
        previousLaidOutBlock === null
          ? 0
          : resolveBlockGap(
              documentIndex.blockIndex,
              previousLaidOutBlock.path,
              indexedBlock.path,
              blockGap,
            ),
      indexedBlock,
      isInert,
      previousLaidOutBlock,
      previousLaidOutBlockIsInert:
        previousLaidOutBlock !== null && isInertBlock(previousLaidOutBlock),
      regionEndIndex,
      regionStartIndex,
    };

    previousLaidOutBlock = indexedBlock;
  }
}
