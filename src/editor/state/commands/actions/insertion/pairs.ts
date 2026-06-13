import type { DocumentIndex } from "../../../index/types";
import { resolveRegion } from "../../../index/query";
import { isSelectionCollapsed, target, type EditorSelection } from "../../../selection";
import type { EditorStateAction } from "../../../types";
import { effect } from "../../../effects";

const INSERTION_PAIRS: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
};

// Paired-delimiter insertion. This stays flat because it sits on the typing
// hot path: one character check, one collapsed-selection check, one region
// lookup, then a splice-text action that leaves the caret between the pair.
export function resolvePairedDelimiterInsertion(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  text: string,
): EditorStateAction | null {
  if (text.length !== 1) {
    return null;
  }

  const close = INSERTION_PAIRS[text];

  if (!close || !isSelectionCollapsed(selection)) {
    return null;
  }

  const region = resolveRegion(documentIndex, selection.focus.regionId);

  if (!region) {
    return null;
  }

  const pairText = `${text}${close}`;

  return {
    effect: effect.textInsertedAtRegion(region, selection.focus.offset, pairText),
    kind: "splice-text",
    selection: target.path(region.path, selection.focus.offset + text.length),
    text: pairText,
  };
}
