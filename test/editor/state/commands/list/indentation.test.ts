import { expect, test } from "bun:test";
import { dedent, indent } from "@/editor/state";
import { createDocumentFromEditorState, createEditorState, setSelection } from "@/editor/state";
import { parseDocument, serializeDocument } from "@/markdown";

test("indents a list item under its previous sibling", () => {
  let state = createEditorState(parseDocument("- alpha\n- beta\n- gamma\n"));
  const beta = state.documentIndex.regions.find((container) => container.text === "beta");

  if (!beta) {
    throw new Error("Expected beta container");
  }

  state = setSelection(state, {
    regionId: beta.id,
    offset: 0,
  });
  state = indent(state) ?? state;

  expect(serializeDocument(createDocumentFromEditorState(state))).toBe(
    "- alpha\n  - beta\n- gamma\n",
  );
});

test("does not indent the first list item without a previous sibling", () => {
  let state = createEditorState(parseDocument("- alpha\n- beta\n"));
  const alpha = state.documentIndex.regions.find((container) => container.text === "alpha");

  if (!alpha) {
    throw new Error("Expected alpha container");
  }

  state = setSelection(state, {
    regionId: alpha.id,
    offset: 0,
  });

  expect(indent(state)).toBeNull();
});

test("dedents a nested list item one level up", () => {
  let state = createEditorState(parseDocument("- alpha\n  - beta\n  - gamma\n- tail\n"));
  const beta = state.documentIndex.regions.find((container) => container.text === "beta");

  if (!beta) {
    throw new Error("Expected nested beta container");
  }

  state = setSelection(state, {
    regionId: beta.id,
    offset: 0,
  });
  state = dedent(state) ?? state;

  expect(serializeDocument(createDocumentFromEditorState(state))).toBe(
    "- alpha\n  - gamma\n- beta\n- tail\n",
  );
});

test("does not dedent top-level list items", () => {
  let state = createEditorState(parseDocument("- alpha\n- beta\n"));
  const beta = state.documentIndex.regions.find((container) => container.text === "beta");

  if (!beta) {
    throw new Error("Expected beta container");
  }

  state = setSelection(state, {
    regionId: beta.id,
    offset: 0,
  });

  expect(dedent(state)).toBeNull();
});

test("routes tab and shift-tab through list indentation semantics", () => {
  let state = createEditorState(parseDocument("- alpha\n- beta\n"));
  const beta = state.documentIndex.regions.find((container) => container.text === "beta");

  if (!beta) {
    throw new Error("Expected beta container");
  }

  state = setSelection(state, {
    regionId: beta.id,
    offset: 0,
  });
  state = indent(state) ?? state;

  expect(serializeDocument(createDocumentFromEditorState(state))).toBe("- alpha\n  - beta\n");

  const nestedBeta = state.documentIndex.regions.find((container) => container.text === "beta");

  if (!nestedBeta) {
    throw new Error("Expected nested beta container");
  }

  state = setSelection(state, {
    regionId: nestedBeta.id,
    offset: 0,
  });
  state = dedent(state) ?? state;

  expect(serializeDocument(createDocumentFromEditorState(state))).toBe("- alpha\n- beta\n");
});
