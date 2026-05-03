import type { DocumentIndex } from "../../index/types";
import type { EditorStateAction } from "../../types";
import type { EditorSelection } from "../../selection";
import { resolveInsertionTrigger } from "./triggers";

// Text insertion dispatcher.
//
// Insertion has one default behavior and one substantial override:
//
//   - default: splice the typed characters into the current selection
//     (the hot path while the user types).
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
    resolveInsertionTrigger(documentIndex, selection, text)
    ?? { kind: "splice-text", selection, text }
  );
}
