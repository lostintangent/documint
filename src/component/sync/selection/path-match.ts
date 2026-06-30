// External snapshot path trust policy. Component sync owns path reuse,
// duplicate handling, and fallback ordering for host-supplied markdown.

import {
  countRootBlocks,
  findUniqueEditorPathWithText,
  forEachEditorPathWithText,
  hasSameEditorTextPathShape,
  isRootIndexedBlock,
  resolveBlockTextPathBoundary,
  resolveEditorTextAtPath,
  resolveIndexedBlockContainingPath,
  type EditorState,
  type IndexedBlock,
} from "@/editor/state";
import {
  hasSelectionAnchorTextContinuity,
  resolveNodeAnchorForPath,
  type SelectionAnchor,
} from "@/editor/anchors";
import { rootBlockPath } from "@/document";

export function resolveExternalPathMatch(
  previousState: EditorState,
  previousPath: string,
  previousText: string,
  nextState: EditorState,
  pointAnchor: SelectionAnchor,
) {
  const previousBlock = resolveIndexedBlockContainingPath(previousState.documentIndex, previousPath);

  if (!previousBlock || (previousText.length === 0 && isRootParagraphWithEmptyText(previousBlock))) {
    return null;
  }

  const samePathText = resolveEditorTextAtPath(nextState.documentIndex, previousPath);
  const rootTopologyStayedPut =
    countRootBlocks(previousState.documentIndex) === countRootBlocks(nextState.documentIndex);
  const samePathMatch =
    samePathText !== null &&
    rootTopologyStayedPut &&
    resolveSamePathMatch(previousState, previousPath, previousText, nextState, pointAnchor);

  if (
    samePathMatch &&
    !hasCompetingExactTextPath(previousBlock.block.type, previousText, nextState, samePathMatch)
  ) {
    return samePathMatch;
  }

  const rootShiftMatch = resolveRootShiftedExactTextPath(
    previousBlock,
    previousPath,
    previousText,
    previousState,
    nextState,
  );

  if (
    rootShiftMatch &&
    !hasCompetingExactTextPath(previousBlock.block.type, previousText, nextState, rootShiftMatch)
  ) {
    return rootShiftMatch;
  }

  const anchorPath = resolveNodeAnchorPath(previousState, previousPath, nextState);

  if (anchorPath === "ambiguous") {
    return null;
  }

  if (anchorPath) {
    return anchorPath;
  }

  if (samePathMatch) {
    return samePathMatch;
  }

  const uniquePathWithText = resolveUniqueExactTextPath(
    previousBlock.block.type,
    previousText,
    nextState,
  );

  if (uniquePathWithText) {
    return uniquePathWithText;
  }

  return resolvePathAfterInsertedEmptyRoot(
    previousState,
    previousPath,
    previousText,
    nextState,
    samePathText,
    pointAnchor,
  );
}

function isRootParagraphWithEmptyText(block: IndexedBlock) {
  return isRootIndexedBlock(block) && block.block.type === "paragraph";
}

function hasCompetingExactTextPath(
  previousBlockType: IndexedBlock["block"]["type"],
  previousText: string,
  nextState: EditorState,
  samePath: string | null,
) {
  if (!samePath) {
    return false;
  }

  let hasCompetingPath = false;

  forEachEditorPathWithText(nextState.documentIndex, (path, text, containingBlock) => {
    if (
      containingBlock.block.type !== previousBlockType ||
      text !== previousText ||
      path === samePath
    ) {
      return;
    }

    hasCompetingPath = true;
    return false;
  });

  return hasCompetingPath;
}

function resolveUniqueExactTextPath(
  previousBlockType: IndexedBlock["block"]["type"],
  previousText: string,
  nextState: EditorState,
) {
  return findUniqueEditorPathWithText(
    nextState.documentIndex,
    (_path, text, containingBlock) =>
      containingBlock.block.type === previousBlockType && text === previousText,
  ).path;
}

function resolveRootShiftedExactTextPath(
  previousBlock: IndexedBlock,
  previousPath: string,
  previousText: string,
  previousState: EditorState,
  nextState: EditorState,
) {
  if (!isRootIndexedBlock(previousBlock) || previousBlock.path !== previousPath) {
    return null;
  }

  const shiftedRootIndex =
    previousBlock.rootIndex +
    countRootBlocks(nextState.documentIndex) -
    countRootBlocks(previousState.documentIndex);

  if (
    shiftedRootIndex === previousBlock.rootIndex ||
    shiftedRootIndex < 0 ||
    shiftedRootIndex >= countRootBlocks(nextState.documentIndex)
  ) {
    return null;
  }

  const shiftedPath = rootBlockPath(shiftedRootIndex);
  const shiftedText = resolveEditorTextAtPath(nextState.documentIndex, shiftedPath);

  return shiftedText === previousText &&
    hasSameEditorTextPathShape(
      previousState.documentIndex,
      previousPath,
      nextState.documentIndex,
      shiftedPath,
    )
    ? shiftedPath
    : null;
}

function resolveNodeAnchorPath(
  previousState: EditorState,
  previousPath: string,
  nextState: EditorState,
): string | "ambiguous" | null {
  const anchorMatch = resolveNodeAnchorForPath(
    previousState.documentIndex,
    previousPath,
    nextState.documentIndex,
  );

  return anchorMatch.status === "ambiguous"
    ? "ambiguous"
    : anchorMatch.status === "matched"
      ? anchorMatch.editorPath
      : null;
}

function resolvePathAfterInsertedEmptyRoot(
  previousState: EditorState,
  previousPath: string,
  previousText: string,
  nextState: EditorState,
  samePathText: string | null,
  pointAnchor: SelectionAnchor,
) {
  if (samePathText === null || samePathText.length > 0) {
    return null;
  }

  const insertedBlock = resolveIndexedBlockContainingPath(nextState.documentIndex, previousPath);
  if (
    !insertedBlock ||
    !isRootIndexedBlock(insertedBlock) ||
    insertedBlock.block.type !== "paragraph"
  ) {
    return null;
  }

  const shiftedPath = resolveBlockTextPathBoundary(
    nextState.documentIndex,
    rootBlockPath(insertedBlock.rootIndex + 1),
    "start",
  );
  const shiftedText = shiftedPath
    ? resolveEditorTextAtPath(nextState.documentIndex, shiftedPath)
    : null;
  if (
    !shiftedPath ||
    shiftedText === null ||
    !hasSameEditorTextPathShape(
      previousState.documentIndex,
      previousPath,
      nextState.documentIndex,
      shiftedPath,
    )
  ) {
    return null;
  }

  return hasSelectionAnchorTextContinuity(previousText, shiftedText, pointAnchor)
    ? shiftedPath
    : null;
}

function resolveSamePathMatch(
  previousState: EditorState,
  previousPath: string,
  previousText: string,
  nextState: EditorState,
  pointAnchor: SelectionAnchor,
) {
  if (
    !hasSameEditorTextPathShape(
      previousState.documentIndex,
      previousPath,
      nextState.documentIndex,
      previousPath,
    )
  ) {
    return null;
  }

  const nextText = resolveEditorTextAtPath(nextState.documentIndex, previousPath);

  return nextText !== null && hasSelectionAnchorTextContinuity(previousText, nextText, pointAnchor)
    ? previousPath
    : null;
}
