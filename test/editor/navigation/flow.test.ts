import { describe, expect, test } from "bun:test";
import { moveCaretVertically } from "@/editor/navigation";
import { createEditorLayoutState, createLayoutCache } from "@/editor";
import { getPath, placeAt, setup } from "../helpers";

describe("Inert leaf blocks", () => {
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
