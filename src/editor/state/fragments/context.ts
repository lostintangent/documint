import type { Block } from "@/document";
import type { DocumentIndex, IndexedTableCell } from "../index/types";
import {
  resolveIndexedText,
  resolveIndexedBlockContainingPath,
  resolveIndexedTextInlines,
  resolveIndexedTableCell,
} from "../index/query";
import {
  normalizeSelection,
  type EditorSelection,
  type NormalizedEditorSelection,
} from "../selection";
import type { LeafTrimTarget } from "./blocks";

// Fragment source context. Copy/extract needs a normalized, non-collapsed
// selection plus the resolved endpoint paths and roots so extraction can
// decide whether the result is inline, one narrowed root, or a cross-root
// structural slice.

export type FragmentEndpoint = LeafTrimTarget & {
  path: string;
  tableCell: IndexedTableCell | null;
};

export type FragmentSourceContext =
  | {
      endpoint: FragmentEndpoint;
      kind: "single-path";
      normalized: NormalizedEditorSelection;
      root: Block;
      wholePath: boolean;
    }
  | {
      endEndpoint: FragmentEndpoint;
      endRoot: Block;
      kind: "multi-path";
      normalized: NormalizedEditorSelection;
      sameRoot: boolean;
      startEndpoint: FragmentEndpoint;
      startRoot: Block;
    };

export function resolveFragmentSourceContext(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): FragmentSourceContext | null {
  const normalized = normalizeSelection(documentIndex, selection);

  if (normalized.collapsed) {
    return null;
  }

  const startEndpoint = resolveFragmentEndpoint(documentIndex, normalized.start.path);
  const endEndpoint = resolveFragmentEndpoint(documentIndex, normalized.end.path);

  if (!startEndpoint || !endEndpoint) {
    return null;
  }

  const startRoot = documentIndex.document.blocks[startEndpoint.indexedBlock.rootIndex];
  const endRoot = documentIndex.document.blocks[endEndpoint.indexedBlock.rootIndex];

  if (!startRoot || !endRoot) {
    return null;
  }

  if (startEndpoint.path === endEndpoint.path) {
    return {
      endpoint: startEndpoint,
      kind: "single-path",
      normalized,
      root: startRoot,
      wholePath:
        normalized.start.offset === 0 && normalized.end.offset === startEndpoint.text.length,
    };
  }

  return {
    endEndpoint,
    endRoot,
    kind: "multi-path",
    normalized,
    sameRoot: startEndpoint.indexedBlock.rootIndex === endEndpoint.indexedBlock.rootIndex,
    startEndpoint,
    startRoot,
  };
}

export function resolveFragmentEndpoint(
  documentIndex: DocumentIndex,
  path: string,
): FragmentEndpoint | null {
  const indexedText = resolveIndexedText(documentIndex, path);
  const indexedBlock = resolveIndexedBlockContainingPath(documentIndex, path);

  if (!indexedText || !indexedBlock) {
    return null;
  }

  return {
    inlines: resolveIndexedTextInlines(indexedText),
    indexedBlock,
    path,
    tableCell: resolveIndexedTableCell(documentIndex, path),
    text: indexedText.text,
  };
}
