// Shared geometry primitive for painters that fill a rectangle spanning a
// document offset range on a single line — currently the selection highlight
// and the comment underline. Both clip a [start, end) range to the line and
// translate the endpoints to visual x coordinates via `resolveLineVisualLeft`,
// which is bidi-aware.

import { resolveLineVisualLeft, type DocumentLayout } from "@/editor/layout";
import type { EditorState } from "@/editor/state";

export function resolveLineRangeRect(
  editorState: EditorState,
  line: DocumentLayout["lines"][number],
  startOffset: number,
  endOffset: number,
  minimumWidth: number,
) {
  const left = resolveLineVisualLeft(editorState, line, startOffset - line.start);
  const right = resolveLineVisualLeft(editorState, line, endOffset - line.start);

  return {
    left,
    width: Math.max(minimumWidth, right - left),
  };
}
