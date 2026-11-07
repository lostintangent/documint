import type { Block } from "@/document";
import type { DocumentIndex, IndexedTableCell } from "../index/types";
import {
  resolveIndexedText,
  resolveIndexedBlockContainingPath,
  resolveIndexedTextInlines,
  resolveIndexedTableCell,
} from "../index/query";
import { normalizeSelection, type EditorSelection, type EditorSelectionPoint } from "../selection";
import type { LeafTrimTarget } from "./blocks";

// Fragment range. Copy, paste, and structural replace all start from the
// selection's ordered endpoints, each resolved to its text, containing block,
// and root, so they can decide between inline, single-root, and cross-root
// handling.

export type FragmentEndpoint = LeafTrimTarget & {
  path: string;
  root: Block;
  tableCell: IndexedTableCell | null;
};

export type FragmentRange = {
  collapsed: boolean;
  end: FragmentEndpoint;
  start: FragmentEndpoint;
};

export function resolveFragmentRange(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): FragmentRange | null {
  const { collapsed, end, start } = normalizeSelection(documentIndex, selection);
  const startEndpoint = resolveFragmentEndpoint(documentIndex, start);
  const endEndpoint = resolveFragmentEndpoint(documentIndex, end);

  return startEndpoint && endEndpoint
    ? { collapsed, end: endEndpoint, start: startEndpoint }
    : null;
}

function resolveFragmentEndpoint(
  documentIndex: DocumentIndex,
  { offset, path }: EditorSelectionPoint,
): FragmentEndpoint | null {
  const indexedText = resolveIndexedText(documentIndex, path);
  const indexedBlock = resolveIndexedBlockContainingPath(documentIndex, path);

  if (!indexedText || !indexedBlock) {
    return null;
  }

  return {
    indexedBlock,
    inlines: resolveIndexedTextInlines(indexedText),
    offset,
    path,
    root: documentIndex.document.blocks[indexedBlock.rootIndex]!,
    tableCell: resolveIndexedTableCell(documentIndex, path),
    text: indexedText.text,
  };
}
