import { effect } from "../../../effects";
import type { DocumentIndex } from "../../../index/types";
import type { EditorSelection, EditorSelectionRange } from "../../../selection";
import type { EditorStateAction } from "../../../types";

// Plain text replacement actions. This is the default typing path, so the
// resolver stays deliberately flat: build the `splice-text` action directly,
// attach the insertion effect when the edit is renderable as inline text, and
// let the reducer resolve the post-splice caret.
export function resolveSelectionTextReplacement(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  text: string,
): EditorStateAction {
  return {
    effect: effect.textInsertedAtSelection(documentIndex, selection, text),
    kind: "splice-text",
    range: selection,
    text,
  };
}

export function resolveTextRangeReplacement(
  documentIndex: DocumentIndex,
  { endOffset, path, startOffset }: EditorSelectionRange,
  text: string,
): EditorStateAction {
  return {
    effect: effect.textInsertedAtPath(documentIndex, path, startOffset, text),
    kind: "splice-text",
    range: { anchor: { path, offset: startOffset }, focus: { path, offset: endOffset } },
    text,
  };
}
