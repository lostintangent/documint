// Document-flow primitives shared by navigation, deletion, layout planning,
// and hit testing. These helpers describe which regions and leaf blocks
// participate in editable/visual flow; they do not mutate editor state.

import type { DocumentIndex } from "../state/index/types";

// Step one position backward / forward through the flat document-order
// region array. This is the primitive both keyboard navigation and
// boundary-delete use to find "the visually previous / next editable
// position."
export function previousRegionInFlow(documentIndex: DocumentIndex, regionId: string) {
  const index = documentIndex.regionOrderIndex.get(regionId);

  if (index === undefined || index === 0) {
    return null;
  }

  return documentIndex.regions[index - 1] ?? null;
}

export function nextRegionInFlow(documentIndex: DocumentIndex, regionId: string) {
  const index = documentIndex.regionOrderIndex.get(regionId);

  if (index === undefined) {
    return null;
  }

  return documentIndex.regions[index + 1] ?? null;
}

// Inert blocks contribute layout and paint geometry but no editable region:
// divider today; future image-as-block, embed, display-math. The property is
// structural, so future inert block types qualify automatically once their
// builder skips region creation.
export function isInertBlock(block: { regionIds: readonly string[]; type: string }): boolean {
  return block.regionIds.length === 0 && !isContainerBlock(block);
}

// Container blocks wrap further blocks rather than holding their own region
// or chrome. Their leaf descendants emit regions and chrome; the containers
// themselves are skipped by layout, planning, and block-flow walks.
export function isContainerBlock(block: { type: string }): boolean {
  return block.type === "blockquote" || block.type === "list" || block.type === "listItem";
}

// Step one position backward / forward through the flat document-order
// leaf-block sequence. Container blocks are skipped. Unlike region flow, this
// includes inert leaf blocks because they have block entries despite having no
// editable regions.
export function previousBlockInFlow(documentIndex: DocumentIndex, blockId: string) {
  return findAdjacentBlockInFlow(documentIndex, blockId, -1);
}

export function nextBlockInFlow(documentIndex: DocumentIndex, blockId: string) {
  return findAdjacentBlockInFlow(documentIndex, blockId, 1);
}

// First editable region in document flow within the given root, or null when
// the root has no regions.
export function firstInFlowRegionOfRoot(documentIndex: DocumentIndex, rootIndex: number) {
  return documentIndex.roots[rootIndex]?.regions[0] ?? null;
}

function findAdjacentBlockInFlow(
  documentIndex: DocumentIndex,
  fromBlockId: string,
  direction: -1 | 1,
) {
  const startBlock = documentIndex.blockIndex.get(fromBlockId);

  if (!startBlock) {
    return null;
  }

  const { blocks } = documentIndex;

  for (
    let index = startBlock.blockArrayIndex + direction;
    index >= 0 && index < blocks.length;
    index += direction
  ) {
    const block = blocks[index]!;

    if (!isContainerBlock(block)) {
      return block;
    }
  }

  return null;
}
