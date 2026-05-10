import type { TextRangeContext } from "../../context";
import type { EditorSelection } from "../../selection";
import type { EditorStateAction } from "../../types";

export function resolveTextReplacement(
  selection: EditorSelection,
  text: string,
): EditorStateAction {
  return {
    kind: "splice-text",
    selection,
    text,
  };
}

export function resolveTextRangeReplacement(
  context: TextRangeContext,
  text: string,
): EditorStateAction {
  return resolveTextReplacement(context.selection, text);
}
