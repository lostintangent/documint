import { describe, expect, test } from "bun:test";
import {
  isInertBlock,
  moveCaretHorizontally,
  moveCaretVertically,
  nextBlockInFlow,
  previousBlockInFlow,
} from "@/editor/navigation";
import { createEditorLayoutState, createLayoutCache } from "@/editor";
import { getRegion, placeAt, setup } from "../helpers";

describe("Inert leaf blocks", () => {
  test("participate in block flow without creating editable regions", () => {
    const state = setup("alpha\n\n---\n\nbeta\n");
    const divider = state.documentIndex.blocks.find((block) => block.type === "divider");

    if (!divider) {
      throw new Error("Expected divider block");
    }

    expect(isInertBlock(divider)).toBe(true);
    expect(previousBlockInFlow(state.documentIndex, divider.id)?.type).toBe("paragraph");
    expect(nextBlockInFlow(state.documentIndex, divider.id)?.type).toBe("paragraph");
  });

  test("right arrow at end of paragraph skips the divider and lands at start of the next paragraph", () => {
    const state = setup("alpha\n\n---\n\nbeta\n");
    const alpha = getRegion(state, "alpha");
    const beta = getRegion(state, "beta");

    const next = moveCaretHorizontally(placeAt(state, alpha, "end"), 1);

    expect(next.selection.focus.regionId).toBe(beta.id);
    expect(next.selection.focus.offset).toBe(0);
  });

  test("left arrow at start of paragraph skips the divider and lands at end of the previous paragraph", () => {
    const state = setup("alpha\n\n---\n\nbeta\n");
    const alpha = getRegion(state, "alpha");
    const beta = getRegion(state, "beta");

    const next = moveCaretHorizontally(placeAt(state, beta, "start"), -1);

    expect(next.selection.focus.regionId).toBe(alpha.id);
    expect(next.selection.focus.offset).toBe(alpha.text.length);
  });

  test("down arrow from a paragraph above a divider lands in the paragraph below it", () => {
    const state = setup("alpha\n\n---\n\nbeta\n");
    const alpha = getRegion(state, "alpha");
    const beta = getRegion(state, "beta");
    const layout = createEditorLayoutState(
      state,
      { height: 2_000, top: 0, width: 320 },
      createLayoutCache(),
    );

    const next = moveCaretVertically(placeAt(state, alpha, "end"), layout, 1);

    expect(next.selection.focus.regionId).toBe(beta.id);
  });

  test("up arrow from a paragraph below a divider lands in the paragraph above it", () => {
    const state = setup("alpha\n\n---\n\nbeta\n");
    const alpha = getRegion(state, "alpha");
    const beta = getRegion(state, "beta");
    const layout = createEditorLayoutState(
      state,
      { height: 2_000, top: 0, width: 320 },
      createLayoutCache(),
    );

    const next = moveCaretVertically(placeAt(state, beta, "start"), layout, -1);

    expect(next.selection.focus.regionId).toBe(alpha.id);
  });
});
