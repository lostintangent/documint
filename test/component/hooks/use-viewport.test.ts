import { expect, test } from "bun:test";
import { shouldInvalidateViewportAfterEditorTransition } from "@/component/hooks/useViewport";
import { insertText, setSelection } from "@/editor";
import { setup } from "@test/editor/helpers";

test("keeps viewport layout for selection-only editor transitions", () => {
  const state = setup("alpha\n");
  const region = state.documentIndex.regions[0]!;
  const nextState = setSelection(state, {
    offset: region.text.length,
    regionId: region.id,
  });

  expect(shouldInvalidateViewportAfterEditorTransition(state, nextState)).toBe(false);
});

test("invalidates viewport layout immediately for document transitions", () => {
  const state = setup("alpha\n");
  const nextState = insertText(state, "!");

  if (!nextState) {
    throw new Error("Expected text insertion to produce a state transition");
  }

  expect(shouldInvalidateViewportAfterEditorTransition(state, nextState)).toBe(true);
});
