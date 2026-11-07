import type { IndexedBlock, IndexedTableCell } from "../../state";
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
        kind: "preformatted",
        path: indexedBlock.path,
        text: indexedBlock.text,
      };
    default:
      return null;
  }
}

export function tableCellLayoutTextInput(cell: IndexedTableCell): LayoutTextInput {
  return {
    inlines: cell.inlines,
    kind: "inlines",
    path: cell.path,
    text: cell.text,
  };
}
