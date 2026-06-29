import { describe, expect, test } from "bun:test";
import { selectAll } from "@/editor/state";
import { setup } from "../../helpers";

describe("Select all", () => {
  test("selectAll expands the selection from the start of the first region to the end of the last", () => {
    const state = setup("# Heading\n\nalpha\n\n- one\n- two\n\ngamma\n");
    const [first] = state.documentIndex.regions;
    const last = state.documentIndex.regions.at(-1);

    if (!first || !last) {
      throw new Error("Expected first and last regions");
    }

    const nextState = selectAll(state);

    expect(nextState.selection.anchor).toEqual({ offset: 0, regionPath: first.path });
    expect(nextState.selection.focus).toEqual({
      offset: last.text.length,
      regionPath: last.path,
    });
  });

  test("selectAll collapses to a single point on an empty document", () => {
    const state = setup("");
    const nextState = selectAll(state);

    // An empty document normalizes to a single empty paragraph, so the range
    // from first-region-start to last-region-end collapses to one point.
    expect(nextState.selection.anchor).toEqual(nextState.selection.focus);
  });
});
