import type { Block } from "@/document";
import type { DocumentIndex, EditorRegion } from "../index/types";
import { normalizeSelection, resolveRegion, type EditorSelection, type NormalizedEditorSelection } from "../selection";

export type FragmentSourceContext =
  | {
      kind: "single-region";
      normalized: NormalizedEditorSelection;
      region: EditorRegion;
      root: Block;
      wholeRegion: boolean;
    }
  | {
      kind: "multi-region";
      normalized: NormalizedEditorSelection;
      startRegion: EditorRegion;
      endRegion: EditorRegion;
      sameRoot: boolean;
      startRoot: Block;
      endRoot: Block;
    };

export type FragmentDestinationContext = {
  normalized: NormalizedEditorSelection;
  sameRegion: boolean;
  startRegion: EditorRegion;
  endRegion: EditorRegion;
  structuralBlocked: boolean;
  prefersVerbatimFallback: boolean;
};

export function resolveFragmentSourceContext(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): FragmentSourceContext | null {
  const normalized = normalizeSelection(documentIndex, selection);

  if (normalized.collapsed) {
    return null;
  }

  const startRegion = resolveRegion(documentIndex, normalized.start.regionId);
  const endRegion = resolveRegion(documentIndex, normalized.end.regionId);

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

export function resolveFragmentDestinationContext(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): FragmentDestinationContext | null {
  const normalized = normalizeSelection(documentIndex, selection);
  const startRegion = resolveRegion(documentIndex, normalized.start.regionId);
  const endRegion = resolveRegion(documentIndex, normalized.end.regionId);

  if (!startRegion || !endRegion) {
    return null;
  }

  const structuralBlocked = isOpaqueRegion(startRegion) || isOpaqueRegion(endRegion);

  return {
    normalized,
    sameRegion: startRegion === endRegion,
    startRegion,
    endRegion,
    structuralBlocked,
    prefersVerbatimFallback:
      startRegion.blockType === "code" || endRegion.blockType === "code",
  };
}

function isOpaqueRegion(region: EditorRegion): boolean {
  return region.blockType === "table" || region.blockType === "code";
}
