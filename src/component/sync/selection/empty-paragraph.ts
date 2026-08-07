// Repairs a transient empty root paragraph after an external markdown snapshot
// drops it. This is component-sync policy because the repair mutates the
// rebuilt editor state by inserting an editor-only empty paragraph back into
// the document.

import {
  areSelectionPointsEqual,
  countRootBlocks,
  findEditorPathWithText,
  findUniqueEditorPathWithText,
  hasSameEditorTextPathShape,
  isRootIndexedBlock,
  resolveBlockTextPathBoundary,
  resolveEditorTextAtPath,
  resolveIndexedBlockContainingPath,
  setSelection,
  spliceDocumentIndex,
  type EditorState,
} from "@/editor/state";
import { createSelectionAnchor, hasSelectionAnchorTextContinuity } from "@/editor/anchors";
import { createParagraphTextBlock, rootBlockPath, spliceDocument } from "@/document";
import { resolveExternalPathMatch } from "./path-match";

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

  const previousPath = resolveSelectedEmptyRootParagraph(previousState);

  if (!previousPath) {
    return null;
  }

  const insertionRootIndex = resolveRecreatedEmptyParagraphRootIndex(
    previousState,
    nextState,
    previousPath,
  );

  if (insertionRootIndex === null) {
    return null;
  }

  return recreateEmptyRootParagraphSelection(nextState, insertionRootIndex);
}

function resolveSelectedEmptyRootParagraph(state: EditorState) {
  const path = state.selection.focus.path;
  const text = resolveEditorTextAtPath(state.documentIndex, path);
  const block = resolveIndexedBlockContainingPath(state.documentIndex, path);

  if (!block || text === null) {
    return null;
  }

  if (block.block.type !== "paragraph" || text !== "" || !isRootIndexedBlock(block)) {
    return null;
  }

  return path;
}

// Pick the rootIndex in `nextState` where to insert the recreated empty
// paragraph by anchoring it to the nearest surviving non-empty root content
// around its previous position. Returns `null` when neither neighbor
// survives or when the surviving neighbors are out of order.
function resolveRecreatedEmptyParagraphRootIndex(
  previousState: EditorState,
  nextState: EditorState,
  previousPath: string,
) {
  const previousBlock = resolveIndexedBlockContainingPath(
    previousState.documentIndex,
    previousPath,
  );

  if (!previousBlock) {
    return null;
  }

  const precedingPath = findNearestNonEmptyRootPath(
    previousState,
    previousBlock.rootIndex,
    "before",
  );
  const followingPath = findNearestNonEmptyRootPath(
    previousState,
    previousBlock.rootIndex,
    "after",
  );
  const precedingMatch = precedingPath
    ? resolveEmptyParagraphNeighborRootIndex(previousState, precedingPath, nextState)
    : null;
  const followingMatch = followingPath
    ? resolveEmptyParagraphNeighborRootIndex(previousState, followingPath, nextState)
    : null;

  if (precedingMatch !== null && followingMatch !== null) {
    return precedingMatch < followingMatch ? followingMatch : null;
  }

  if (precedingMatch !== null) {
    return followingPath && hasMatchingNeighborPath(nextState, previousState, followingPath)
      ? null
      : precedingMatch + 1;
  }

  if (followingMatch !== null) {
    return precedingPath && hasMatchingNeighborPath(nextState, previousState, precedingPath)
      ? null
      : followingMatch;
  }

  return null;
}

function hasMatchingNeighborPath(
  nextState: EditorState,
  previousState: EditorState,
  previousPath: string,
) {
  const previousText = resolveEditorTextAtPath(previousState.documentIndex, previousPath);

  if (previousText === null) {
    return false;
  }

  const midpointAnchor = createMidpointSelectionAnchor(previousText);

  return (
    findEditorPathWithText(nextState.documentIndex, (candidatePath) =>
      isEmptyParagraphNeighborPathMatch(
        previousState,
        previousPath,
        previousText,
        nextState,
        candidatePath,
        midpointAnchor,
      ),
    ) !== null
  );
}

function resolveEmptyParagraphNeighborRootIndex(
  previousState: EditorState,
  previousPath: string,
  nextState: EditorState,
) {
  const previousText = resolveEditorTextAtPath(previousState.documentIndex, previousPath);
  const previousBlock = resolveIndexedBlockContainingPath(
    previousState.documentIndex,
    previousPath,
  );

  if (!previousBlock || previousText === null) {
    return null;
  }

  const midpointAnchor = createMidpointSelectionAnchor(previousText);
  const matchedPath = resolveExternalPathMatch(
    previousState,
    previousPath,
    previousText,
    nextState,
    midpointAnchor,
  );

  const matchedRootIndex = matchedPath ? resolveRootIndexForPath(nextState, matchedPath) : null;

  return (
    matchedRootIndex ??
    resolveShiftedEmptyParagraphNeighborRootIndex(
      previousState,
      previousPath,
      previousText,
      previousBlock.rootIndex,
      nextState,
      midpointAnchor,
    )
  );
}

function resolveShiftedEmptyParagraphNeighborRootIndex(
  previousState: EditorState,
  previousPath: string,
  previousText: string,
  previousRootIndex: number,
  nextState: EditorState,
  midpointAnchor: ReturnType<typeof createSelectionAnchor>,
) {
  const candidateRootIndexes = [previousRootIndex, previousRootIndex - 1];
  let match: number | null = null;

  for (const rootIndex of candidateRootIndexes) {
    const candidate = findUniqueEditorPathWithText(
      nextState.documentIndex,
      (path) =>
        isEmptyParagraphNeighborPathMatch(
          previousState,
          previousPath,
          previousText,
          nextState,
          path,
          midpointAnchor,
        ),
      { rootIndex },
    );

    if (candidate.ambiguous) {
      return null;
    }

    if (!candidate.path) {
      continue;
    }

    if (match) {
      return null;
    }

    match = rootIndex;
  }

  return match;
}

function isEmptyParagraphNeighborPathMatch(
  previousState: EditorState,
  previousPath: string,
  previousText: string,
  nextState: EditorState,
  nextPath: string,
  midpointAnchor: ReturnType<typeof createSelectionAnchor>,
) {
  const nextText = resolveEditorTextAtPath(nextState.documentIndex, nextPath);

  if (
    nextText === null ||
    !hasSameEditorTextPathShape(
      previousState.documentIndex,
      previousPath,
      nextState.documentIndex,
      nextPath,
    )
  ) {
    return false;
  }

  return hasSelectionAnchorTextContinuity(previousText, nextText, midpointAnchor);
}

function createMidpointSelectionAnchor(text: string) {
  return createSelectionAnchor(text, Math.floor(text.length / 2), "neutral");
}

function recreateEmptyRootParagraphSelection(nextState: EditorState, rootIndex: number) {
  const nextDocument = spliceDocument(nextState.documentIndex.document, rootIndex, 0, [
    createParagraphTextBlock(""),
  ]);
  const restoredState = {
    ...nextState,
    documentIndex: spliceDocumentIndex(nextState.documentIndex, nextDocument, rootIndex, 0),
  };
  const path = resolveBlockTextPathBoundary(
    restoredState.documentIndex,
    rootBlockPath(rootIndex),
    "start",
  );
  const selection = path
    ? {
        anchor: { path, offset: 0 },
        focus: { path, offset: 0 },
      }
    : null;

  return selection ? setSelection(restoredState, selection, false) : null;
}

// Walk roots outward from `rootIndex` in `direction` and return the first
// non-empty path encountered. Used as a stable reference when recreating a
// transient empty paragraph the markdown round-trip dropped.
function findNearestNonEmptyRootPath(
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
    const path = findFirstNonEmptyPathInRoot(state, index, direction);

    if (path) {
      return path;
    }
  }

  return null;
}

function findFirstNonEmptyPathInRoot(
  state: EditorState,
  rootIndex: number,
  direction: RootScanDirection,
) {
  return findEditorPathWithText(state.documentIndex, (_path, text) => text.length > 0, {
    rootIndex,
    direction: direction === "before" ? -1 : 1,
  });
}

function resolveRootIndexForPath(state: EditorState, path: string) {
  const block = resolveIndexedBlockContainingPath(state.documentIndex, path);

  return block?.rootIndex ?? null;
}
