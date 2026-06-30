import {
  anchorKindForBlockType,
  listAnchorContainers,
  type AnchorContainer,
  type AnchorMatch,
} from "@/document";
import {
  indexedOffsetToPlainTextOffset,
  plainTextOffsetToIndexedOffset,
  resolveIndexedText,
  resolveIndexedBlockContainingPath,
  resolveIndexedTableCell,
  resolveIndexedTextInlines,
  type DocumentIndex,
  type IndexedInline,
  type InlineOffsetAffinity,
} from "../state";

type EditorAnchorPath = {
  anchorContainer: AnchorContainer;
  inlines: readonly IndexedInline[] | null;
  path: string;
  text: string;
};

type EditorDocumentRange = {
  anchorContainer: Pick<AnchorContainer, "containerKind" | "text">;
  endOffset: number;
  path: string;
  startOffset: number;
};

type EditorAnchorRange = {
  anchorContainer: AnchorContainer;
  endOffset: number;
  path: string;
  startOffset: number;
};

export type EditorTextAnchorResolver = {
  listContainers(containerKind?: AnchorContainer["containerKind"]): AnchorContainer[];
  resolveEditorRange(
    match: Pick<
      AnchorMatch,
      "containerOrdinal" | "containerPath" | "endOffset" | "startOffset"
    >,
    options?: { collapsedAffinity?: InlineOffsetAffinity },
  ): EditorAnchorRange | null;
};

export function createEditorTextAnchorResolver(
  documentIndex: DocumentIndex,
): EditorTextAnchorResolver {
  const anchorContainers = listAnchorContainers(documentIndex.document);
  const anchorContainersByPath = new Map(
    anchorContainers.map((container) => [container.path, container]),
  );
  const resolvePath = (
    match: Pick<AnchorMatch, "containerOrdinal" | "containerPath">,
  ): EditorAnchorPath | null => {
    const anchorContainer = anchorContainersByPath.get(match.containerPath) ?? null;

    if (!anchorContainer) {
      return null;
    }

    // The ordinal comes from the same current-snapshot container list as the
    // path. Keep it as a consistency check, not as a fallback location.
    if (anchorContainer.containerOrdinal !== match.containerOrdinal) {
      return null;
    }

    const indexedText = resolveIndexedText(documentIndex, anchorContainer.path);

    if (!indexedText) {
      return null;
    }

    const inlines = resolveIndexedTextInlines(indexedText);

    return {
      anchorContainer,
      inlines,
      path: anchorContainer.path,
      text: indexedText.text,
    };
  };

  return {
    listContainers(containerKind) {
      return containerKind
        ? anchorContainers.filter((container) => container.containerKind === containerKind)
        : anchorContainers;
    },
    resolveEditorRange(match, options) {
      const resolved = resolvePath(match);

      if (!resolved) {
        return null;
      }

      const isCollapsed = match.startOffset === match.endOffset;
      const startOffset = plainTextOffsetToIndexedOffset(
        resolved.text,
        resolved.inlines,
        match.startOffset,
        isCollapsed ? (options?.collapsedAffinity ?? "after") : "before",
      );

      return {
        anchorContainer: resolved.anchorContainer,
        endOffset: isCollapsed
          ? startOffset
          : plainTextOffsetToIndexedOffset(
              resolved.text,
              resolved.inlines,
              match.endOffset,
              "after",
            ),
        path: resolved.path,
        startOffset,
      };
    },
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
  const anchorContainer = resolveAnchorContainerForPath(documentIndex, path);
  const indexedText = resolveIndexedText(documentIndex, path);

  if (!anchorContainer || !indexedText) {
    return null;
  }

  return {
    anchorContainer,
    endOffset: indexedOffsetToPlainTextOffset(
      indexedText.text,
      resolveIndexedTextInlines(indexedText),
      range.endOffset,
    ),
    path,
    startOffset: indexedOffsetToPlainTextOffset(
      indexedText.text,
      resolveIndexedTextInlines(indexedText),
      range.startOffset,
    ),
  };
}

function resolveAnchorContainerForPath(
  documentIndex: DocumentIndex,
  path: string,
): Pick<AnchorContainer, "containerKind" | "text"> | null {
  const indexedText = resolveIndexedText(documentIndex, path);

  if (!indexedText) {
    return null;
  }

  const indexedCell = resolveIndexedTableCell(documentIndex, path);
  if (indexedCell) {
    const cell = indexedCell.cell;

    return cell
      ? { containerKind: "tableCell", text: cell.plainText }
      : null;
  }

  const indexedBlock = resolveIndexedBlockContainingPath(documentIndex, path);
  const containerKind = indexedBlock
    ? anchorKindForBlockType(indexedBlock.block.type)
    : null;

  return containerKind && indexedBlock
    ? { containerKind, text: indexedBlock.block.plainText }
    : null;
}
