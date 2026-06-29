// Repairs a transient empty root paragraph after an external markdown snapshot
// drops it. This is component-sync policy because the repair mutates the
// rebuilt editor state by inserting an editor-only empty paragraph back into
// the document.

import {
  areSelectionPointsEqual,
  countRootBlocks,
  hasSameEditableRegionShape,
  isRootIndexedBlock,
  resolveIndexedBlockForRegion,
  resolveRegion,
  resolveRootPrimaryRegion,
  resolveRootRegions,
  setSelection,
  spliceDocumentIndex,
  type EditableRegion,
  type EditorState,
} from "@/editor/state";
import {
  createSelectionAnchor,
  hasSelectionAnchorTextContinuity,
} from "@/editor/anchors";
import { createParagraphTextBlock, spliceDocument } from "@/document";
import { resolveExternalRegionMatch } from "./region-match";

type RootScanDirection = "after" | "before";

// Recreate a transient empty root paragraph that markdown round-trip dropped.
// Only fires when the previous selection was a collapsed caret in such a
// paragraph and a stable surviving root nearby can anchor the recreation.
export function restoreTransientEmptyRootParagraphSelection(
  previousState: EditorState,
  nextState: EditorState,
) {
  if (!areSelectionPointsEqual(previousState.selection.anchor, previousState.selection.focus)) {
    return null;
  }

  const previousRegion = resolveSelectedEmptyRootParagraph(previousState);

  if (!previousRegion) {
    return null;
  }

  const insertionRootIndex = resolveRecreatedEmptyParagraphRootIndex(
    previousState,
    nextState,
    previousRegion,
  );

  if (insertionRootIndex === null) {
    return null;
  }

  return recreateEmptyRootParagraphSelection(nextState, insertionRootIndex);
}

function resolveSelectedEmptyRootParagraph(state: EditorState) {
  const region = resolveRegion(state.documentIndex, state.selection.focus.regionPath);

  if (!region || region.block.type !== "paragraph" || region.text.length > 0) {
    return null;
  }

  const block = resolveIndexedBlockForRegion(state.documentIndex, region.path);

  return block && isRootIndexedBlock(block) ? region : null;
}

// Pick the rootIndex in `nextState` where to insert the recreated empty
// paragraph by anchoring it to the nearest surviving non-empty root content
// around its previous position. Returns `null` when neither neighbor
// survives or when the surviving neighbors are out of order (a structural
// rewrite we shouldn't second-guess).
function resolveRecreatedEmptyParagraphRootIndex(
  previousState: EditorState,
  nextState: EditorState,
  previousRegion: EditableRegion,
) {
  const precedingRegion = findNearestNonEmptyRootRegion(
    previousState,
    previousRegion.rootIndex,
    "before",
  );
  const followingRegion = findNearestNonEmptyRootRegion(
    previousState,
    previousRegion.rootIndex,
    "after",
  );
  const precedingMatch = precedingRegion
    ? resolveEmptyParagraphNeighborRegion(previousState, precedingRegion, nextState)
    : null;
  const followingMatch = followingRegion
    ? resolveEmptyParagraphNeighborRegion(previousState, followingRegion, nextState)
    : null;

  if (precedingMatch && followingMatch) {
    return precedingMatch.rootIndex < followingMatch.rootIndex ? followingMatch.rootIndex : null;
  }

  if (precedingMatch) {
    return followingRegion && hasMatchingNeighborRegion(nextState, followingRegion)
      ? null
      : precedingMatch.rootIndex + 1;
  }

  if (followingMatch) {
    return precedingRegion && hasMatchingNeighborRegion(nextState, precedingRegion)
      ? null
      : followingMatch.rootIndex;
  }

  return null;
}

function hasMatchingNeighborRegion(nextState: EditorState, previousRegion: EditableRegion) {
  return nextState.documentIndex.regions.some((candidate) =>
    isEmptyParagraphNeighborMatch(previousRegion, candidate),
  );
}

function resolveEmptyParagraphNeighborRegion(
  previousState: EditorState,
  previousRegion: EditableRegion,
  nextState: EditorState,
) {
  const midpointAnchor = createMidpointSelectionAnchor(previousRegion);

  return (
    resolveExternalRegionMatch(
      previousState,
      previousRegion,
      nextState,
      midpointAnchor,
    ) ?? resolveShiftedEmptyParagraphNeighborRegion(previousRegion, nextState)
  );
}

function resolveShiftedEmptyParagraphNeighborRegion(
  previousRegion: EditableRegion,
  nextState: EditorState,
) {
  const candidateRootIndexes = [previousRegion.rootIndex, previousRegion.rootIndex - 1];
  let match: EditableRegion | null = null;

  for (const rootIndex of candidateRootIndexes) {
    for (const candidate of resolveRootRegions(nextState.documentIndex, rootIndex)) {
      if (!isEmptyParagraphNeighborMatch(previousRegion, candidate)) {
        continue;
      }

      if (match) {
        return null;
      }

      match = candidate;
    }
  }

  return match;
}

function isEmptyParagraphNeighborMatch(
  previousRegion: EditableRegion,
  nextRegion: EditableRegion,
) {
  if (!hasSameEditableRegionShape(previousRegion, nextRegion)) {
    return false;
  }

  const midpointAnchor = createMidpointSelectionAnchor(previousRegion);

  return hasSelectionAnchorTextContinuity(
    previousRegion.text,
    nextRegion.text,
    midpointAnchor,
  );
}

function createMidpointSelectionAnchor(region: EditableRegion) {
  return createSelectionAnchor(region.text, Math.floor(region.text.length / 2), "neutral");
}

function recreateEmptyRootParagraphSelection(nextState: EditorState, rootIndex: number) {
  const nextDocument = spliceDocument(nextState.documentIndex.document, rootIndex, 0, [
    createParagraphTextBlock(""),
  ]);
  const restoredState = {
    ...nextState,
    documentIndex: spliceDocumentIndex(nextState.documentIndex, nextDocument, rootIndex, 0),
  };
  const region = resolveRootPrimaryRegion(restoredState.documentIndex, rootIndex);
  const selection = region
    ? {
        anchor: { regionPath: region.path, offset: 0 },
        focus: { regionPath: region.path, offset: 0 },
      }
    : null;

  return selection ? setSelection(restoredState, selection, false) : null;
}

// Walk roots outward from `rootIndex` in `direction` and return the first
// non-empty region encountered. Used as a stable reference when recreating
// a transient empty paragraph the markdown round-trip dropped.
function findNearestNonEmptyRootRegion(
  state: EditorState,
  rootIndex: number,
  direction: RootScanDirection,
) {
  const step = direction === "before" ? -1 : 1;

  for (
    let index = rootIndex + step;
    index >= 0 && index < countRootBlocks(state.documentIndex);
    index += step
  ) {
    const region = findFirstNonEmptyRegionInRoot(state, index, direction);

    if (region) {
      return region;
    }
  }

  return null;
}

function findFirstNonEmptyRegionInRoot(
  state: EditorState,
  rootIndex: number,
  direction: RootScanDirection,
) {
  const regions = resolveRootRegions(state.documentIndex, rootIndex);
  const start = direction === "before" ? regions.length - 1 : 0;
  const step = direction === "before" ? -1 : 1;

  for (let index = start; index >= 0 && index < regions.length; index += step) {
    const region = regions[index];

    if (region && region.text.length > 0) {
      return region;
    }
  }

  return null;
}
