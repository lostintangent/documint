import { expect, test } from "bun:test";
import { shouldInvalidateLayoutAfterEditorTransition } from "@/component/hooks/useViewport";
import { insertText, setSelection } from "@/editor";
import { setup } from "@test/editor/helpers";

test("keeps cached layout for selection-only editor transitions", () => {
  const state = setup("alpha\n");
  const region = state.documentIndex.regions[0]!;
  const nextState = setSelection(state, {
    offset: region.text.length,
    regionPath: region.path,
  });

  expect(shouldInvalidateLayoutAfterEditorTransition(state, nextState)).toBe(false);
});

test("invalidates cached layout immediately for document transitions", () => {
  const state = setup("alpha\n");
  const nextState = insertText(state, "!");

  if (!nextState) {
    throw new Error("Expected text insertion to produce a state transition");
  }

  expect(shouldInvalidateLayoutAfterEditorTransition(state, nextState)).toBe(true);
});
