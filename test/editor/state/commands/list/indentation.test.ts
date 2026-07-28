import { describe, expect, test } from "bun:test";
import { createEditorState, dedent, indent } from "@/editor/state";
import { parseDocument } from "@/markdown";
import { getPath, placeAt, setup, toMarkdown } from "../../../helpers";

describe("List indentation", () => {
  test("indents a list item under its previous sibling", () => {
    let state = setup("- alpha\n- beta\n- gamma\n");
    const beta = getPath(state, "beta");

    state = placeAt(state, beta, 0);
    state = indent(state) ?? state;

    expect(toMarkdown(state)).toBe("- alpha\n  - beta\n- gamma\n");
  });

  test("does not indent the first list item without a previous sibling", () => {
    let state = setup("- alpha\n- beta\n");
    const alpha = getPath(state, "alpha");

    state = placeAt(state, alpha, 0);

    expect(indent(state)).toBeNull();
  });

  test("restarts ordered numbering for a nested list", () => {
    let state = setup("1. alpha\n2. beta\n");
    const beta = getPath(state, "beta");

    state = placeAt(state, beta, 0);
    state = indent(state) ?? state;

    expect(toMarkdown(state)).toBe("1. alpha\n   1. beta\n");
  });

  test("reuses a canonical nested list under a preserved-start parent", () => {
    let state = createEditorState(
      parseDocument("3. alpha\n4. beta\n5. gamma\n", {
        preserveOrderedListStart: true,
      }),
    );
    const beta = getPath(state, "beta");

    state = placeAt(state, beta, 0);
    state = indent(state) ?? state;

    const gamma = getPath(state, "gamma");

    state = placeAt(state, gamma, 0);
    state = indent(state) ?? state;

    expect(toMarkdown(state)).toBe("3. alpha\n   1. beta\n   2. gamma\n");
  });

  test("preserves an existing nested list start when appending an item", () => {
    let state = createEditorState(
      parseDocument("3. alpha\n   7. child\n4. beta\n", {
        preserveOrderedListStart: true,
      }),
    );
    const beta = getPath(state, "beta");

    state = placeAt(state, beta, 0);
    state = indent(state) ?? state;

    expect(toMarkdown(state)).toBe("3. alpha\n   7. child\n   8. beta\n");
  });

  test("dedents a nested list item one level up", () => {
    let state = setup("- alpha\n  - beta\n  - gamma\n- tail\n");
    const beta = getPath(state, "beta");

    state = placeAt(state, beta, 0);
    state = dedent(state) ?? state;

    expect(toMarkdown(state)).toBe("- alpha\n  - gamma\n- beta\n- tail\n");
  });

  test("does not dedent top-level list items", () => {
    let state = setup("- alpha\n- beta\n");
    const beta = getPath(state, "beta");

    state = placeAt(state, beta, 0);

    expect(dedent(state)).toBeNull();
  });

  test("routes tab and shift-tab through list indentation semantics", () => {
    let state = setup("- alpha\n- beta\n");
    const beta = getPath(state, "beta");

    state = placeAt(state, beta, 0);
    state = indent(state) ?? state;

    expect(toMarkdown(state)).toBe("- alpha\n  - beta\n");

    const nestedBeta = getPath(state, "beta");

    state = placeAt(state, nestedBeta, 0);
    state = dedent(state) ?? state;

    expect(toMarkdown(state)).toBe("- alpha\n- beta\n");
  });
});
