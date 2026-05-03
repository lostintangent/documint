import { expect, test } from "bun:test";
import { dedent, indent } from "@/editor/state";
import { getRegion, placeAt, setup, toMarkdown } from "../../../helpers";

test("indents a list item under its previous sibling", () => {
  let state = setup("- alpha\n- beta\n- gamma\n");
  const beta = getRegion(state, "beta");

  state = placeAt(state, beta, 0);
  state = indent(state) ?? state;

  expect(toMarkdown(state)).toBe(
    "- alpha\n  - beta\n- gamma\n",
  );
});

test("does not indent the first list item without a previous sibling", () => {
  let state = setup("- alpha\n- beta\n");
  const alpha = getRegion(state, "alpha");

  state = placeAt(state, alpha, 0);

  expect(indent(state)).toBeNull();
});

test("dedents a nested list item one level up", () => {
  let state = setup("- alpha\n  - beta\n  - gamma\n- tail\n");
  const beta = getRegion(state, "beta");

  state = placeAt(state, beta, 0);
  state = dedent(state) ?? state;

  expect(toMarkdown(state)).toBe(
    "- alpha\n  - gamma\n- beta\n- tail\n",
  );
});

test("does not dedent top-level list items", () => {
  let state = setup("- alpha\n- beta\n");
  const beta = getRegion(state, "beta");

  state = placeAt(state, beta, 0);

  expect(dedent(state)).toBeNull();
});

test("routes tab and shift-tab through list indentation semantics", () => {
  let state = setup("- alpha\n- beta\n");
  const beta = getRegion(state, "beta");

  state = placeAt(state, beta, 0);
  state = indent(state) ?? state;

  expect(toMarkdown(state)).toBe("- alpha\n  - beta\n");

  const nestedBeta = getRegion(state, "beta");

  state = placeAt(state, nestedBeta, 0);
  state = dedent(state) ?? state;

  expect(toMarkdown(state)).toBe("- alpha\n- beta\n");
});
