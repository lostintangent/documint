// Owns the leaf-block walk shared by exact layout and virtual height estimation.

import { isContainerBlock, isInertBlock, type DocumentIndex } from "../../state";
import { resolveBlockGap } from "./block-spacing";

export type LayoutBlockWalkEntry = {
  blockRegionsInScope: string[];
  gapBefore: number;
  indexedBlock: DocumentIndex["blocks"][number];
  isInert: boolean;
  previousLaidOutBlock: DocumentIndex["blocks"][number] | null;
  previousLaidOutBlockIsInert: boolean;
};

export function* walkLayoutBlocks(
  documentIndex: DocumentIndex,
  {
    blockGap,
    layoutBlocks = documentIndex.blocks,
    visibleRegionIds,
  }: {
    blockGap: number;
    layoutBlocks?: DocumentIndex["blocks"];
    visibleRegionIds?: Set<string>;
  },
): Generator<LayoutBlockWalkEntry> {
  let previousLaidOutBlock: DocumentIndex["blocks"][number] | null = null;

  for (const indexedBlock of layoutBlocks) {
    if (isContainerBlock(indexedBlock)) continue;

    const isInert = isInertBlock(indexedBlock);
    const blockRegionsInScope = visibleRegionIds
      ? indexedBlock.regionIds.filter((id) => visibleRegionIds.has(id))
      : indexedBlock.regionIds;

    // Skip text/table blocks whose regions are outside this walk. Inert leaves
    // still lay out because they reserve block-flow height without regions.
    if (!isInert && blockRegionsInScope.length === 0) continue;

    yield {
      blockRegionsInScope,
      gapBefore:
        previousLaidOutBlock === null
          ? 0
          : resolveBlockGap(
              documentIndex.blockIndex,
              previousLaidOutBlock.block.id,
              indexedBlock.block.id,
              blockGap,
            ),
      indexedBlock,
      isInert,
      previousLaidOutBlock,
      previousLaidOutBlockIsInert:
        previousLaidOutBlock !== null && isInertBlock(previousLaidOutBlock),
    };

    previousLaidOutBlock = indexedBlock;
  }
}
