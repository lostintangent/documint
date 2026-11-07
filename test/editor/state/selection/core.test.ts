import { describe, expect, test } from "bun:test";
import { selectAll } from "@/editor/state";
import { indexedTextEntries, setup } from "../../helpers";

describe("Select all", () => {
  test("selectAll expands the selection from the start of the first path to the end of the last", () => {
    const state = setup("# Heading\n\nalpha\n\n- one\n- two\n\ngamma\n");
    const [first] = indexedTextEntries(state);
    const last = indexedTextEntries(state).at(-1);

    if (!first || !last) {
      throw new Error("Expected first and last paths");
    }

    const nextState = selectAll(state);

    expect(nextState.selection.anchor).toEqual({ offset: 0, path: first.path });
    expect(nextState.selection.focus).toEqual({
      offset: last.text.length,
      path: last.path,
    });
  });
});
