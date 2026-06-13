import type { TextRangeContext } from "../../context";
import { effect } from "../../../effects";
import type { DocumentIndex } from "../../../index/types";
import type { EditorSelection } from "../../../selection";
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
    text,
  };
}

export function resolveTextRangeReplacement(
  context: TextRangeContext,
  text: string,
): EditorStateAction {
  return {
    effect: effect.textInsertedAtRegion(context.region, context.startOffset, text),
    kind: "splice-text",
    range: context.selection,
    text,
  };
}
