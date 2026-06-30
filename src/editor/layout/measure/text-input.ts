import type { DocumentIndex, IndexedBlock, IndexedTableCell } from "../../state";
import { resolveIndexedBlock, resolveIndexedTableCell } from "../../state";
import type { LayoutTextInput } from "./text";

export function resolveBlockLayoutTextInput(indexedBlock: IndexedBlock): LayoutTextInput | null {
  switch (indexedBlock.kind) {
    case "inlines":
      return {
        inlines: indexedBlock.inlines,
        kind: "inlines",
        path: indexedBlock.path,
        text: indexedBlock.text,
      };
    case "source":
      return {
        kind: "source",
        path: indexedBlock.path,
        text: indexedBlock.text,
      };
    default:
      return null;
  }
}

export function resolveLayoutTextInputAtPath(documentIndex: DocumentIndex, path: string) {
  const indexedBlock = resolveIndexedBlock(documentIndex, path);

  if (indexedBlock) {
    const input = resolveBlockLayoutTextInput(indexedBlock);
    return input ? { indexedBlock, input } : null;
  }

  const cell = resolveIndexedTableCell(documentIndex, path);
  const tableBlock = cell ? resolveIndexedBlock(documentIndex, cell.tablePath) : null;

  return cell && tableBlock
    ? { indexedBlock: tableBlock, input: tableCellLayoutTextInput(cell) }
    : null;
}

export function tableCellLayoutTextInput(
  cell: IndexedTableCell,
): LayoutTextInput {
  return {
    inlines: cell.inlines,
    kind: "inlines",
    path: cell.path,
    text: cell.text,
  };
}
