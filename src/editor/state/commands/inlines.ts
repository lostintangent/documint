// Shared inline-region helpers. `InlineContainer` resolves editable document
// regions whose backing data is `Inline[]`. The runtime data we need — block,
// container path, table cell — is already on `EditableRegion` and the document
// block; this resolver assembles them with no path-string parsing.

import type {
  Block,
  HeadingBlock,
  Inline,
  ParagraphBlock,
  TableBlock,
  TableCell,
} from "@/document";
import { resolveBlockPathForRegion, resolveRegion, resolveTableCellPosition } from "../index/query";
import type { DocumentIndex, EditableRegion } from "../index/types";

export type InlineContainer =
  | {
      block: HeadingBlock | ParagraphBlock;
      children: Inline[];
      kind: "inlineBlock";
      path: string;
    }
  | {
      block: TableBlock;
      blockPath: string;
      cell: TableCell;
      children: Inline[];
      kind: "tableCell";
      path: string;
    };

export function resolveInlineContainer(documentIndex: DocumentIndex, regionId: string) {
  const region = resolveRegion(documentIndex, regionId);

  if (!region) {
    return null;
  }

  return resolveInlineContainerFromRegion(
    region.block,
    region,
    resolveBlockPathForRegion(documentIndex, region.id),
  );
}

// Build an `InlineContainer` from a resolved document block plus its
// runtime `EditableRegion`. The region already carries `containerPath` and
// `tableCellPosition` from the index — no regex re-parsing required.
function resolveInlineContainerFromRegion(
  block: Block,
  region: EditableRegion,
  blockPath: string | null,
): InlineContainer | null {
  if (block.type === "heading" || block.type === "paragraph") {
    return {
      block,
      children: block.children,
      kind: "inlineBlock",
      path: region.containerPath,
    };
  }

  const tableCellPosition = resolveTableCellPosition(region);

  if (block.type !== "table" || !tableCellPosition || !blockPath) {
    return null;
  }

  const { rowIndex, cellIndex } = tableCellPosition;
  const cell = block.rows[rowIndex]?.cells[cellIndex];

  if (!cell) {
    return null;
  }

  return {
    block,
    blockPath,
    cell,
    children: cell.children,
    kind: "tableCell",
    path: region.containerPath,
  };
}
