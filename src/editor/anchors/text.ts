import {
  anchorKindForBlockType,
  listAnchorContainers,
  type AnchorContainer,
  type AnchorMatch,
} from "@/document";
import type { DocumentIndex, EditableRegion } from "../state";
import {
  plainTextOffsetToRegionOffset,
  regionOffsetToPlainTextOffset,
  type InlineOffsetAffinity,
} from "../state/index/inlines";

type EditorAnchorContainer = {
  anchorContainer: AnchorContainer;
  runtimeContainer: EditableRegion | null;
};

type EditorDocumentRange = {
  anchorContainer: Pick<AnchorContainer, "containerKind" | "text">;
  endOffset: number;
  runtimeContainer: EditableRegion;
  startOffset: number;
};

type EditorAnchorRange = {
  anchorContainer: AnchorContainer;
  endOffset: number;
  runtimeContainer: EditableRegion;
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
  const runtimeContainersByPath = new Map(
    documentIndex.regions.map((region) => [region.containerPath, region]),
  );
  const resolveContainer = (
    match: Pick<AnchorMatch, "containerOrdinal" | "containerPath">,
  ): EditorAnchorContainer | null => {
    const anchorContainer = anchorContainersByPath.get(match.containerPath) ?? null;

    if (!anchorContainer) {
      return null;
    }

    // The ordinal comes from the same current-snapshot container list as the
    // path. Keep it as a consistency check, not as a fallback location.
    if (anchorContainer.containerOrdinal !== match.containerOrdinal) {
      return null;
    }

    return {
      anchorContainer,
      runtimeContainer: runtimeContainersByPath.get(anchorContainer.path) ?? null,
    };
  };

  return {
    listContainers(containerKind) {
      return containerKind
        ? anchorContainers.filter((container) => container.containerKind === containerKind)
        : anchorContainers;
    },
    resolveEditorRange(match, options) {
      const container = resolveContainer(match);
      const runtimeContainer = container?.runtimeContainer ?? null;

      if (!container || !runtimeContainer) {
        return null;
      }

      const isCollapsed = match.startOffset === match.endOffset;
      const startOffset = plainTextOffsetToRegionOffset(
        runtimeContainer,
        match.startOffset,
        isCollapsed ? (options?.collapsedAffinity ?? "after") : "before",
      );

      return {
        anchorContainer: container.anchorContainer,
        endOffset: isCollapsed
          ? startOffset
          : plainTextOffsetToRegionOffset(runtimeContainer, match.endOffset, "after"),
        runtimeContainer,
        startOffset,
      };
    },
  };
}

export function resolveDocumentRangeForRegion(
  runtimeContainer: EditableRegion,
  range: {
    endOffset: number;
    startOffset: number;
  },
): EditorDocumentRange | null {
  const anchorContainer = resolveAnchorContainerForRegion(runtimeContainer);

  if (!anchorContainer) {
    return null;
  }

  return {
    anchorContainer,
    endOffset: regionOffsetToPlainTextOffset(runtimeContainer, range.endOffset),
    runtimeContainer,
    startOffset: regionOffsetToPlainTextOffset(runtimeContainer, range.startOffset),
  };
}

function resolveAnchorContainerForRegion(
  region: EditableRegion,
): Pick<AnchorContainer, "containerKind" | "text"> | null {
  if (region.tableCellPosition) {
    if (region.block.type !== "table") {
      return null;
    }

    const { cellIndex, rowIndex } = region.tableCellPosition;
    const cell = region.block.rows[rowIndex]?.cells[cellIndex] ?? null;

    return cell ? { containerKind: "tableCell", text: cell.plainText } : null;
  }

  const containerKind = anchorKindForBlockType(region.block.type);

  return containerKind ? { containerKind, text: region.block.plainText } : null;
}
