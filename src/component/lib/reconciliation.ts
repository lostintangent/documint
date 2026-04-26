/**
 * Host-side reconciliation for external content snapshots. Keeps focus
 * sticky across a rebuilt editor state without entering the local editing
 * action-dispatch path.
 *
 * Reconciles:
 *   - equivalent selections across stable, moved, or edited text regions
 *   - cursor/range offsets when text is inserted or deleted around the selection
 *   - transient empty root paragraphs that markdown rebuilds cannot represent
 *
 * Intentionally does not attempt full document rebase. Ambiguous duplicate
 * regions, structural rewrites, nested empty blocks, and deleted selection
 * endpoints fall back to the caller's reload behavior.
 */

import {
  createRootPrimaryRegionTarget,
  resolveSelectionTarget,
  setSelection,
  spliceDocumentIndex,
  type EditorRegion,
  type EditorSelection,
  type EditorSelectionPoint,
  type EditorState,
} from "@/editor/state";
import {
  captureContextWindows,
  clamp,
  createParagraphTextBlock,
  findContextRanges,
  findOccurrences,
  spliceDocument,
} from "@/document";

type OffsetAffinity = "after-prefix" | "before-suffix" | "neutral";
type RootScanDirection = "after" | "before";

export type ExternalContentReconciliation = {
  didReconcile: boolean;
  state: EditorState;
};

// --- Public API ---

export function reconcileExternalContentChange(
  previousState: EditorState | null,
  nextState: EditorState,
): ExternalContentReconciliation {
  if (!previousState) {
    return { didReconcile: false, state: nextState };
  }

  // Prefer semantic region/offset repair. Recreate transient empty paragraphs
  // only when normal selection reconciliation cannot find an equivalent point.
  const restoredState =
    restoreEquivalentSelection(previousState, nextState) ??
    restoreTransientEmptyParagraphSelection(previousState, nextState);

  return restoredState
    ? { didReconcile: true, state: restoredState }
    : { didReconcile: false, state: nextState };
}

// --- Selection rebase ---

// Apply the equivalent selection (if any) to `nextState`. Exposed so tests
// can observe the post-rebase selection without re-running the whole
// reconcile.
export function restoreEquivalentSelection(
  previousState: EditorState,
  nextState: EditorState,
): EditorState | null {
  const equivalentSelection = resolveEquivalentSelection(previousState, nextState);

  return equivalentSelection ? setSelection(nextState, equivalentSelection, false) : null;
}

// Compute the selection in `nextState` that semantically matches the
// selection in `previousState`. Returns `null` when either endpoint cannot
// be unambiguously placed, signaling the caller to fall back.
export function resolveEquivalentSelection(
  previousState: EditorState,
  nextState: EditorState,
): EditorSelection | null {
  if (areSelectionPointsEqual(previousState.selection.anchor, previousState.selection.focus)) {
    const point = resolveEquivalentSelectionPoint(
      previousState,
      nextState,
      previousState.selection.focus,
      "neutral",
    );

    return point ? { anchor: point, focus: point } : null;
  }

  const selectionAffinity = resolveSelectionPointAffinity(previousState);
  const anchor = resolveEquivalentSelectionPoint(
    previousState,
    nextState,
    previousState.selection.anchor,
    selectionAffinity.anchor,
  );
  const focus = resolveEquivalentSelectionPoint(
    previousState,
    nextState,
    previousState.selection.focus,
    selectionAffinity.focus,
  );

  return anchor && focus ? { anchor, focus } : null;
}

function resolveEquivalentSelectionPoint(
  previousState: EditorState,
  nextState: EditorState,
  point: EditorSelectionPoint,
  affinity: OffsetAffinity,
): EditorSelectionPoint | null {
  const previousRegion = previousState.documentIndex.regionIndex.get(point.regionId);

  if (!previousRegion) {
    return null;
  }

  const nextRegion = resolveEquivalentRegion(previousRegion, nextState);

  if (!nextRegion) {
    return null;
  }

  return {
    offset: resolveEquivalentOffset(previousRegion.text, nextRegion.text, point.offset, affinity),
    regionId: nextRegion.id,
  };
}

// Find the region in `nextState` that semantically corresponds to
// `previousRegion`. Strategies in priority order:
//   1. Same id survived → use it.
//   2. Empty text isn't a stable anchor (markdown rebuilds drop empties) → null.
//   3. Region with matching block kind and identical text appears exactly
//      once in `nextState` → use it.
//   4. Same path → use it (after unique-text because paths shift when
//      content is inserted above the selection).
function resolveEquivalentRegion(previousRegion: EditorRegion, nextState: EditorState) {
  const sameIdRegion = nextState.documentIndex.regionIndex.get(previousRegion.id);

  if (sameIdRegion) {
    return sameIdRegion;
  }

  if (previousRegion.text.length === 0) {
    return null;
  }

  const uniqueTextRegion = resolveUniqueTextRegion(previousRegion, nextState);

  if (uniqueTextRegion) {
    return uniqueTextRegion;
  }

  return nextState.documentIndex.regionPathIndex.get(previousRegion.path) ?? null;
}

function resolveUniqueTextRegion(previousRegion: EditorRegion, nextState: EditorState) {
  let match: EditorRegion | null = null;

  for (const candidate of nextState.documentIndex.regions) {
    if (
      candidate.blockType !== previousRegion.blockType ||
      candidate.text !== previousRegion.text
    ) {
      continue;
    }

    if (match) {
      return null;
    }

    match = candidate;
  }

  return match;
}

// Translate `offset` from `previousText` to `nextText` using the surrounding
// `CONTEXT_WINDOW` characters as a content-addressable fingerprint. Tries
// (in order): unique prefix-suffix sandwich, unique prefix, unique suffix,
// then clamps to the new text length as a last resort. `affinity` decides
// whether prefix or suffix wins when both produce a candidate.
function resolveEquivalentOffset(
  previousText: string,
  nextText: string,
  offset: number,
  affinity: OffsetAffinity,
) {
  const previousOffset = clamp(offset, 0, previousText.length);
  const { prefix, suffix } = captureContextWindows(previousText, previousOffset, previousOffset);

  const contextOffset = resolveOffsetBetweenContext(nextText, prefix, suffix);

  if (contextOffset !== null) {
    return contextOffset;
  }

  const prefixOffset = resolveOffsetAfterUniquePrefix(nextText, prefix);
  const suffixOffset = resolveOffsetBeforeUniqueSuffix(nextText, suffix);

  if (affinity === "before-suffix") {
    return suffixOffset ?? prefixOffset ?? clamp(offset, 0, nextText.length);
  }

  return prefixOffset ?? suffixOffset ?? clamp(offset, 0, nextText.length);
}

function resolveOffsetBetweenContext(text: string, prefix: string, suffix: string) {
  // Selection rebase wants prefix and suffix to bracket a single point — i.e.,
  // the suffix starts exactly where the prefix ends. The shared primitive
  // returns every (startOffset, endOffset) pair; we filter to point matches
  // and require uniqueness.
  const points = findContextRanges(text, prefix, suffix).filter(
    (range) => range.startOffset === range.endOffset,
  );

  return points.length === 1 ? points[0].startOffset : null;
}

function resolveOffsetAfterUniquePrefix(text: string, prefix: string) {
  const occurrences = findOccurrences(text, prefix);

  return occurrences.length === 1 ? occurrences[0] + prefix.length : null;
}

function resolveOffsetBeforeUniqueSuffix(text: string, suffix: string) {
  const occurrences = findOccurrences(text, suffix);

  return occurrences.length === 1 ? occurrences[0] : null;
}

function resolveSelectionPointAffinity(state: EditorState): {
  anchor: OffsetAffinity;
  focus: OffsetAffinity;
} {
  const { anchor, focus } = state.selection;

  if (areSelectionPointsEqual(anchor, focus)) {
    return {
      anchor: "neutral",
      focus: "neutral",
    };
  }

  // Range starts should stay before the selected text; range ends should stay
  // after it. Reverse selections preserve the user's original anchor/focus.
  return compareSelectionPoints(state, anchor, focus) <= 0
    ? {
        anchor: "before-suffix",
        focus: "after-prefix",
      }
    : {
        anchor: "after-prefix",
        focus: "before-suffix",
      };
}

function compareSelectionPoints(
  state: EditorState,
  left: EditorSelectionPoint,
  right: EditorSelectionPoint,
) {
  const leftRegionIndex = state.documentIndex.regionOrderIndex.get(left.regionId);
  const rightRegionIndex = state.documentIndex.regionOrderIndex.get(right.regionId);

  if (leftRegionIndex === undefined || rightRegionIndex === undefined) {
    return 0;
  }

  return leftRegionIndex === rightRegionIndex
    ? left.offset - right.offset
    : leftRegionIndex - rightRegionIndex;
}

// --- Empty paragraph repair ---

// Recreate a transient empty root paragraph that markdown round-trip dropped.
// Only fires when the previous selection was a collapsed caret in such a
// paragraph and a stable surviving root nearby can anchor the recreation.
function restoreTransientEmptyParagraphSelection(
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
  const region = state.documentIndex.regionIndex.get(state.selection.focus.regionId);

  if (!region || region.blockType !== "paragraph" || region.text.length > 0) {
    return null;
  }

  const block = state.documentIndex.blockIndex.get(region.blockId);

  return block?.parentBlockId === null ? region : null;
}

// Pick the rootIndex in `nextState` where to insert the recreated empty
// paragraph by anchoring it to the nearest surviving non-empty root content
// around its previous position. Returns `null` when neither neighbor
// survives or when the surviving neighbors are out of order (a structural
// rewrite we shouldn't second-guess).
function resolveRecreatedEmptyParagraphRootIndex(
  previousState: EditorState,
  nextState: EditorState,
  previousRegion: EditorRegion,
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
    ? resolveEquivalentRegion(precedingRegion, nextState)
    : null;
  const followingMatch = followingRegion
    ? resolveEquivalentRegion(followingRegion, nextState)
    : null;

  if (precedingMatch && followingMatch) {
    return precedingMatch.rootIndex < followingMatch.rootIndex ? followingMatch.rootIndex : null;
  }

  if (precedingMatch) {
    return precedingMatch.rootIndex + 1;
  }

  if (followingMatch) {
    return followingMatch.rootIndex;
  }

  return null;
}

function recreateEmptyRootParagraphSelection(nextState: EditorState, rootIndex: number) {
  const nextDocument = spliceDocument(nextState.documentIndex.document, rootIndex, 0, [
    createParagraphTextBlock({ text: "" }),
  ]);
  const restoredState = {
    ...nextState,
    documentIndex: spliceDocumentIndex(nextState.documentIndex, nextDocument, rootIndex, 0),
  };
  const selection = resolveSelectionTarget(
    restoredState.documentIndex,
    createRootPrimaryRegionTarget(rootIndex),
  );

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
    index >= 0 && index < state.documentIndex.roots.length;
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
  const regions = state.documentIndex.roots[rootIndex]?.regions ?? [];
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

// --- Internal helpers ---

function areSelectionPointsEqual(left: EditorSelectionPoint, right: EditorSelectionPoint) {
  return left.regionId === right.regionId && left.offset === right.offset;
}
