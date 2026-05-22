import type { DocumentIndex } from "../../../index/types";
import { resolveRegion } from "../../../index/query";
import { isSelectionCollapsed, type EditorSelection } from "../../../selection";
import type { EditorStateAction } from "../../../types";
import { resolveTextHighlightAnimation } from "../../../animations/intents";

const INSERTION_PAIRS: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
};

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
    animation: resolveTextHighlightAnimation(documentIndex, selection, pairText),
    kind: "splice-text",
    selection: {
      kind: "region-path",
      offset: selection.focus.offset + text.length,
      path: region.path,
    },
    text: pairText,
  };
}
