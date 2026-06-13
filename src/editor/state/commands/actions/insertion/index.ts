import type { DocumentIndex } from "../../../index/types";
import type { EditorStateAction } from "../../../types";
import type { EditorSelection } from "../../../selection";
import { resolvePairedDelimiterInsertion } from "./pairs";
import { resolveSelectionTextReplacement } from "./replace";
import { resolveInsertionTrigger } from "./triggers";

// Text insertion dispatcher.
//
// Insertion has one default behavior and two substantial overrides:
//
//   - default: splice the typed characters into the current selection
//     (the hot path while the user types).
//   - paired delimiter (`pairs.ts`): when the typed text is an opening
//     delimiter, insert the closing delimiter too and land the caret
//     between them.
//   - markdown trigger (`triggers.ts`): when the typed text completes
//     a markdown shortcut (`# `, `1. `, `> `, …), upgrade the
//     insertion into a structural transform instead — a heading, a
//     list, a blockquote, etc.
//
// The line-break gesture (Enter) is its own dispatcher in
// `line-break.ts`; it doesn't share this code path because Enter has
// no plain-text default — it always produces a structural action
// based on the cursor's block context.
export function resolveTextInsertion(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  text: string,
): EditorStateAction | null {
  return (
    resolvePairedDelimiterInsertion(documentIndex, selection, text) ??
    resolveInsertionTrigger(documentIndex, selection, text) ??
    resolveSelectionTextReplacement(documentIndex, selection, text)
  );
}
