import type { Block } from "@/document";
import type { DocumentIndex, EditableRegion } from "../index/types";
import {
  normalizeSelection,
  resolveRegion,
  type EditorSelection,
  type NormalizedEditorSelection,
} from "../selection";

// Fragment source context. Copy/extract needs a normalized, non-collapsed
// selection plus the resolved endpoint regions and roots so extraction can
// decide whether the result is inline, one narrowed root, or a cross-root
// structural slice.

export type FragmentSourceContext =
  | {
      kind: "single-region";
      normalized: NormalizedEditorSelection;
      region: EditableRegion;
      root: Block;
      wholeRegion: boolean;
    }
  | {
      kind: "multi-region";
      normalized: NormalizedEditorSelection;
      startRegion: EditableRegion;
      endRegion: EditableRegion;
      sameRoot: boolean;
      startRoot: Block;
      endRoot: Block;
    };

export function resolveFragmentSourceContext(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): FragmentSourceContext | null {
  const normalized = normalizeSelection(documentIndex, selection);

  if (normalized.collapsed) {
    return null;
  }

  const startRegion = resolveRegion(documentIndex, normalized.start.regionPath);
  const endRegion = resolveRegion(documentIndex, normalized.end.regionPath);

  if (!startRegion || !endRegion) {
    return null;
  }

  const startRoot = documentIndex.document.blocks[startRegion.rootIndex];
  const endRoot = documentIndex.document.blocks[endRegion.rootIndex];

  if (!startRoot || !endRoot) {
    return null;
  }

  if (startRegion === endRegion) {
    return {
      kind: "single-region",
      normalized,
      region: startRegion,
      root: startRoot,
      wholeRegion:
        normalized.start.offset === 0 && normalized.end.offset === startRegion.text.length,
    };
  }

  return {
    kind: "multi-region",
    normalized,
    startRegion,
    endRegion,
    sameRoot: startRegion.rootIndex === endRegion.rootIndex,
    startRoot,
    endRoot,
  };
}
