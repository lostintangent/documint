import type { DocumentIndex } from "../../../index/types";
import { resolveEditorTextAtPath } from "../../../index/query";
import { isSelectionCollapsed, target, type EditorSelection } from "../../../selection";
import type { EditorStateAction } from "../../../types";
import { effect } from "../../../effects";

const INSERTION_PAIRS: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
};

// Paired-delimiter insertion. This stays flat because it sits on the typing
// hot path: one character check, one collapsed-selection check, one path
// text lookup, then a splice-text action that leaves the caret between the pair.
// A typed closer in front of the same closer steps over it instead, so typing
// `f(x)` keeps one `)` without tracking which closers were auto-inserted.
export function resolvePairedDelimiterInsertion(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  text: string,
): EditorStateAction | null {
  if (text.length !== 1) {
    return null;
  }

  const close = INSERTION_PAIRS[text];

  if ((!close && !")]}".includes(text)) || !isSelectionCollapsed(selection)) {
    return null;
  }

  const { path, offset } = selection.focus;
  const currentText = resolveEditorTextAtPath(documentIndex, path);

  if (currentText === null) {
    return null;
  }

  if (!close) {
    const point = { path, offset: offset + 1 };
    return currentText[offset] === text
      ? { kind: "set-selection", selection: { anchor: point, focus: point } }
      : null;
  }

  const pairText = `${text}${close}`;

  return {
    effect: effect.textInsertedAtPath(documentIndex, path, offset, pairText),
    kind: "splice-text",
    selection: target.path(path, offset + text.length),
    text: pairText,
  };
}
