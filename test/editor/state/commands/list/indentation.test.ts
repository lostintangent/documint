import { describe, expect, test } from "bun:test";
import { dedent, indent } from "@/editor/state";
import { getPath, placeAt, setup, toMarkdown } from "../../../helpers";

describe("List indentation", () => {
  test("indents a list item under its previous sibling", () => {
    let state = setup("- alpha\n- beta\n- gamma\n");
    const beta = getPath(state, "beta");

    state = placeAt(state, beta, 0);
    state = indent(state) ?? state;

    expect(toMarkdown(state)).toBe("- alpha\n  - beta\n- gamma\n");
  });

  test.each([
    [
      "starts a nested ordered list at 1",
      "3. a\n4. b\n5. c\n",
      ["b", "c"],
      "3. a\n   1. b\n   2. c\n",
    ],
    [
      "loosens the parent of a loose item",
      "- a\n- b\n\n  bpara\n",
      ["b"],
      "- a\n\n  - b\n\n    bpara\n",
    ],
    [
      "loosens a tight nested list that takes a loose item",
      "- a\n  - x\n- b\n\n  bpara\n",
      ["b"],
      "- a\n\n  - x\n\n  - b\n\n    bpara\n",
    ],
    [
      "keeps a new nested item snug and an extended loose list loose",
      "- a\n\n  - x\n\n  - y\n\n- b\n\n- c\n",
      ["c", "b"],
      "- a\n\n  - x\n\n  - y\n\n  - b\n    - c\n",
    ],
  ])("indenting %s", (_, source, texts, expected) => {
    let state = setup(source);

    for (const text of texts) {
      state = indent(placeAt(state, getPath(state, text), 0)) ?? state;
    }

    expect(toMarkdown(state)).toBe(expected);
  });

  test("does not indent the first list item without a previous sibling", () => {
    let state = setup("- alpha\n- beta\n");
    const alpha = getPath(state, "alpha");

    state = placeAt(state, alpha, 0);

    expect(indent(state)).toBeNull();
  });

  test("dedents a nested list item one level up", () => {
    let state = setup("- alpha\n  - beta\n  - gamma\n  - delta\n- tail\n");
    const beta = getPath(state, "beta");

    state = placeAt(state, beta, 0);
    state = dedent(state) ?? state;

    expect(toMarkdown(state)).toBe("- alpha\n- beta\n  - gamma\n  - delta\n- tail\n");
  });

  test.each([
    [
      "- alpha\n  - beta\n    - b1\n  - gamma\n  - delta\n\n  more\n",
      "- alpha\n\n- beta\n\n  - b1\n  - gamma\n  - delta\n\n  more\n",
    ],
    [
      "- alpha\n  - beta\n    - b1\n\n    bpara\n  - gamma\n",
      "- alpha\n\n- beta\n\n  - b1\n\n  bpara\n\n  - gamma\n",
    ],
    [
      "- alpha\n\n  - beta\n\n  - gamma\n\n  - delta\n",
      "- alpha\n\n- beta\n\n  - gamma\n\n  - delta\n",
    ],
  ])(
    "dedent keeps the item's own children and the parent's later content in order and spacing",
    (source, expected) => {
      let state = setup(source);

      state = placeAt(state, getPath(state, "beta"), 0);
      state = dedent(state) ?? state;

      expect(toMarkdown(state)).toBe(expected);
    },
  );

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
