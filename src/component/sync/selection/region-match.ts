// External snapshot region trust policy. This module chooses whether a region
// in a newly supplied snapshot is trustworthy enough to carry a selection
// point forward. It deliberately lives in component sync because path reuse,
// duplicate handling, and fallback ordering are external-snapshot policy, not
// generic editor region identity.

import {
  countRootBlocks,
  findUniqueEditableRegion,
  hasSameEditableRegionShape,
  isRootIndexedBlock,
  resolveIndexedBlockForRegion,
  resolveRegion,
  resolveRootRegions,
  type EditableRegion,
  type EditorState,
} from "@/editor/state";
import {
  hasSelectionAnchorTextContinuity,
  resolveNodeAnchorForRegion,
  type SelectionAnchor,
} from "@/editor/anchors";

// Strategies in priority order:
//   1. Empty text isn't a stable normal-region anchor.
//   2. Same path can be reused only with matching root topology, region shape,
//      and selection-anchor text continuity.
//   3. A competing exact-text candidate makes same path yield to node-anchor
//      disambiguation; ambiguous node anchors fail closed.
//   4. If no stronger anchor disagrees, same path or unique projected editor
//      text may carry the selection.
//   5. An inserted empty root can shift selected content by one root only when
//      the shifted region has selection-anchor text continuity.
export function resolveExternalRegionMatch(
  previousState: EditorState,
  previousRegion: EditableRegion,
  nextState: EditorState,
  pointAnchor: SelectionAnchor,
) {
  if (previousRegion.text.length === 0) {
    return null;
  }

  const samePathRegion = resolveRegion(nextState.documentIndex, previousRegion.path);
  const rootTopologyStayedPut =
    countRootBlocks(previousState.documentIndex) === countRootBlocks(nextState.documentIndex);
  const samePathMatch =
    samePathRegion &&
    rootTopologyStayedPut &&
    resolveSamePathRegion(previousRegion, samePathRegion, pointAnchor);

  if (
    samePathMatch &&
    !hasCompetingExactTextRegion(previousRegion, nextState, samePathMatch)
  ) {
    return samePathMatch;
  }

  const anchorRegion = resolveNodeAnchorRegion(previousState, previousRegion, nextState);

  if (anchorRegion === "ambiguous") {
    return null;
  }

  if (anchorRegion) {
    return anchorRegion;
  }

  if (samePathMatch) {
    return samePathMatch;
  }

  const uniqueTextRegion = resolveUniqueTextRegion(previousRegion, nextState);

  if (uniqueTextRegion) {
    return uniqueTextRegion;
  }

  if (!samePathRegion) {
    return null;
  }

  return resolveRegionAfterInsertedEmptyRoot(
    previousRegion,
    nextState,
    samePathRegion,
    pointAnchor,
  );
}

function hasCompetingExactTextRegion(
  previousRegion: EditableRegion,
  nextState: EditorState,
  samePathRegion: EditableRegion,
) {
  return nextState.documentIndex.regions.some(
    (candidate) =>
      candidate.path !== samePathRegion.path &&
      candidate.block.type === previousRegion.block.type &&
      candidate.text === previousRegion.text,
  );
}

function resolveUniqueTextRegion(previousRegion: EditableRegion, nextState: EditorState) {
  return findUniqueEditableRegion(
    nextState.documentIndex,
    (candidate) =>
      candidate.block.type === previousRegion.block.type && candidate.text === previousRegion.text,
  );
}

function resolveNodeAnchorRegion(
  previousState: EditorState,
  previousRegion: EditableRegion,
  nextState: EditorState,
): EditableRegion | "ambiguous" | null {
  const anchorMatch = resolveNodeAnchorForRegion(
    previousState.documentIndex,
    previousRegion,
    nextState.documentIndex,
  );

  if (anchorMatch.status === "ambiguous") {
    return "ambiguous";
  }

  if (anchorMatch.status !== "matched") {
    return null;
  }

  return anchorMatch.region;
}

function resolveRegionAfterInsertedEmptyRoot(
  previousRegion: EditableRegion,
  nextState: EditorState,
  pathRegion: EditableRegion,
  pointAnchor: SelectionAnchor,
) {
  if (
    previousRegion.text.length === 0 ||
    pathRegion.text.length > 0 ||
    pathRegion.block.type !== "paragraph"
  ) {
    return null;
  }

  const insertedBlock = resolveIndexedBlockForRegion(nextState.documentIndex, pathRegion.path);

  if (!insertedBlock || !isRootIndexedBlock(insertedBlock)) {
    return null;
  }

  const [shiftedRegion] = resolveRootRegions(nextState.documentIndex, pathRegion.rootIndex + 1);

  if (
    !shiftedRegion ||
    shiftedRegion.text.length === 0 ||
    shiftedRegion.block.type !== previousRegion.block.type ||
    shiftedRegion.content.kind !== previousRegion.content.kind
  ) {
    return null;
  }

  return hasSelectionAnchorTextContinuity(
    previousRegion.text,
    shiftedRegion.text,
    pointAnchor,
  )
    ? shiftedRegion
    : null;
}

function resolveSamePathRegion(
  previousRegion: EditableRegion,
  nextRegion: EditableRegion,
  pointAnchor: SelectionAnchor,
) {
  if (
    previousRegion.path !== nextRegion.path ||
    !hasSameEditableRegionShape(previousRegion, nextRegion)
  ) {
    return null;
  }

  return hasSelectionAnchorTextContinuity(previousRegion.text, nextRegion.text, pointAnchor)
    ? nextRegion
    : null;
}
