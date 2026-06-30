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
};

export function* walkLayoutBlocks(
  documentIndex: DocumentIndex,
  {
    blockGap,
    layoutBlocks = documentIndex.blocks,
  }: {
    blockGap: number;
    layoutBlocks?: DocumentIndex["blocks"];
  },
): Generator<LayoutBlockWalkEntry> {
  let previousLaidOutBlock: DocumentIndex["blocks"][number] | null = null;

  for (const indexedBlock of layoutBlocks) {
    if (isContainerBlock(indexedBlock)) continue;

    const isInert = isInertBlock(indexedBlock);

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
    };

    previousLaidOutBlock = indexedBlock;
  }
}
