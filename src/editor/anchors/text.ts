import { anchorKindForBlockType, type AnchorContainer, type AnchorMatch } from "@/document";
import {
  indexedOffsetToPlainTextOffset,
  plainTextOffsetToIndexedOffset,
  resolveIndexedText,
  resolveIndexedTextInlines,
  type DocumentIndex,
  type EditorSelectionRange,
  type IndexedText,
  type InlineOffsetAffinity,
} from "../state";

type EditorDocumentRange = {
  anchorContainer: AnchorContainer;
  endOffset: number;
  startOffset: number;
};

// Maps a semantic anchor match, resolved against this index's document, onto
// editor offsets at the same container path.
export function resolveEditorRangeForAnchorMatch(
  documentIndex: DocumentIndex,
  match: Pick<AnchorMatch, "containerPath" | "endOffset" | "startOffset">,
  collapsedAffinity: InlineOffsetAffinity = "after",
): EditorSelectionRange | null {
  const indexedText = resolveIndexedText(documentIndex, match.containerPath);

  if (!indexedText) {
    return null;
  }

  const inlines = resolveIndexedTextInlines(indexedText);
  const isCollapsed = match.startOffset === match.endOffset;
  const startOffset = plainTextOffsetToIndexedOffset(
    indexedText.text,
    inlines,
    match.startOffset,
    isCollapsed ? collapsedAffinity : "before",
  );

  return {
    endOffset: isCollapsed
      ? startOffset
      : plainTextOffsetToIndexedOffset(indexedText.text, inlines, match.endOffset, "after"),
    path: match.containerPath,
    startOffset,
  };
}

export function resolveDocumentRangeForPath(
  documentIndex: DocumentIndex,
  path: string,
  range: {
    endOffset: number;
    startOffset: number;
  },
): EditorDocumentRange | null {
  const indexedText = resolveIndexedText(documentIndex, path);
  const anchorContainer = indexedText ? anchorContainerForText(indexedText) : null;

  if (!indexedText || !anchorContainer) {
    return null;
  }

  const inlines = resolveIndexedTextInlines(indexedText);

  return {
    anchorContainer,
    endOffset: indexedOffsetToPlainTextOffset(indexedText.text, inlines, range.endOffset),
    startOffset: indexedOffsetToPlainTextOffset(indexedText.text, inlines, range.startOffset),
  };
}

// The anchor container an indexed text projects to, or `null` when its block
// can't host anchored content.
export function anchorContainerForText(indexedText: IndexedText): AnchorContainer | null {
  if ("cell" in indexedText) {
    return { containerKind: "tableCell", path: indexedText.path, text: indexedText.cell.plainText };
  }

  if (!("block" in indexedText)) {
    return null;
  }

  const containerKind = anchorKindForBlockType(indexedText.block.type);

  return containerKind
    ? { containerKind, path: indexedText.path, text: indexedText.block.plainText }
    : null;
}
