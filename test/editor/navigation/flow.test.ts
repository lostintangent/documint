import { describe, expect, test } from "bun:test";
import { moveCaretHorizontally, moveCaretVertically } from "@/editor/navigation";
import { isInertBlock, nextBlockInFlow, previousBlockInFlow } from "@/editor/state";
import { createEditorLayoutState, createLayoutCache } from "@/editor";
import { getPath, placeAt, setup } from "../helpers";

describe("Inert leaf blocks", () => {
  test("participate in block flow without creating editable paths", () => {
    const state = setup("alpha\n\n---\n\nbeta\n");
    const divider = state.documentIndex.blocks.find((block) => block.block.type === "divider");

    if (!divider) {
      throw new Error("Expected divider block");
    }

    expect(isInertBlock(divider)).toBe(true);
    expect(previousBlockInFlow(state.documentIndex, divider.path)?.block.type).toBe(
      "paragraph",
    );
    expect(nextBlockInFlow(state.documentIndex, divider.path)?.block.type).toBe("paragraph");
  });

  test("right arrow at end of paragraph skips the divider and lands at start of the next paragraph", () => {
    const state = setup("alpha\n\n---\n\nbeta\n");
    const alpha = getPath(state, "alpha");
    const beta = getPath(state, "beta");

    const next = moveCaretHorizontally(placeAt(state, alpha, "end"), 1);

    expect(next.selection.focus.path).toBe(beta.path);
    expect(next.selection.focus.offset).toBe(0);
  });

  test("left arrow at start of paragraph skips the divider and lands at end of the previous paragraph", () => {
    const state = setup("alpha\n\n---\n\nbeta\n");
    const alpha = getPath(state, "alpha");
    const beta = getPath(state, "beta");

    const next = moveCaretHorizontally(placeAt(state, beta, "start"), -1);

    expect(next.selection.focus.path).toBe(alpha.path);
    expect(next.selection.focus.offset).toBe(alpha.text.length);
  });

  test("down arrow from a paragraph above a divider lands in the paragraph below it", () => {
    const state = setup("alpha\n\n---\n\nbeta\n");
    const alpha = getPath(state, "alpha");
    const beta = getPath(state, "beta");
    const layout = createEditorLayoutState(
      state,
      { height: 2_000, top: 0, width: 320 },
      createLayoutCache(),
    );

    const next = moveCaretVertically(placeAt(state, alpha, "end"), layout, 1);

    expect(next.selection.focus.path).toBe(beta.path);
  });

  test("up arrow from a paragraph below a divider lands in the paragraph above it", () => {
    const state = setup("alpha\n\n---\n\nbeta\n");
    const alpha = getPath(state, "alpha");
    const beta = getPath(state, "beta");
    const layout = createEditorLayoutState(
      state,
      { height: 2_000, top: 0, width: 320 },
      createLayoutCache(),
    );

    const next = moveCaretVertically(placeAt(state, beta, "start"), layout, -1);

    expect(next.selection.focus.path).toBe(alpha.path);
  });
});
