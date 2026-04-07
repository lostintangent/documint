// Inline mark commands for toggling semantic bold, italic, strikethrough, and
// underline styling on selected text within a single editable region.
import { type Mark } from "@/document";
import { toggleInlineMarkTarget } from "../../document-editor";
import type { EditorState } from "../../state";
import { applyInlineSelectionOperation, type InlineCommandHelpers } from ".";

export function toggleSelectionMarkOperation(
  state: EditorState,
  mark: Extract<Mark, "italic" | "bold" | "strikethrough" | "underline">,
  helpers: InlineCommandHelpers,
) {
  return applyInlineSelectionOperation(
    state,
    helpers,
    (target, startOffset, endOffset) =>
      toggleInlineMarkTarget(
        target,
        startOffset,
        endOffset,
        mark,
      ),
  );
}
