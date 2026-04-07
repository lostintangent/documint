// Inline edit commands for wrapping or unwrapping semantic inline code inside a
// single editable region.
import { toggleInlineCodeTarget } from "../../document-editor";
import type { EditorState } from "../../state";
import { applyInlineSelectionOperation, type InlineCommandHelpers } from ".";

export function toggleSelectionInlineCodeOperation(
  state: EditorState,
  helpers: InlineCommandHelpers,
) {
  return applyInlineSelectionOperation(
    state,
    helpers,
    (target, startOffset, endOffset) =>
      toggleInlineCodeTarget(
        target,
        startOffset,
        endOffset,
      ),
  );
}
