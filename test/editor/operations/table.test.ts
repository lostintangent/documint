import { expect, test } from "bun:test";
import { dedent, indent } from "@/editor/model/commands";
import {
  createDocumentFromEditorState,
  createEditorState,
  setCanvasSelection as setSelection,
} from "@/editor/model/state";
import { parseMarkdown, serializeMarkdown } from "@/markdown";

test("moves to the next and previous table cell with tab and shift-tab", () => {
  let state = createEditorState(
    parseMarkdown("| A | B |\n| --- | --- |\n| alpha | beta |\n"),
  );
  const alpha = state.documentEditor.regions.find((container) => container.text === "alpha");

  if (!alpha) {
    throw new Error("Expected alpha table cell");
  }

  state = setSelection(state, {
    regionId: alpha.id,
    offset: 2,
  });

  const nextState = indent(state);
  const previousState = nextState ? dedent(nextState) : null;

  expect(nextState?.selection.focus.regionId).toBe(
    state.documentEditor.regions.find((container) => container.text === "beta")!.id,
  );
  expect(nextState?.selection.focus.offset).toBe(2);
  expect(previousState?.selection.focus.regionId).toBe(alpha.id);
  expect(previousState?.selection.focus.offset).toBe(2);
});

test("moves across table rows with tab and shift-tab", () => {
  let state = createEditorState(
    parseMarkdown("| A | B |\n| --- | --- |\n| alpha | beta |\n| gamma | delta |\n"),
  );
  const beta = state.documentEditor.regions.find((container) => container.text === "beta");
  const gamma = state.documentEditor.regions.find((container) => container.text === "gamma");

  if (!beta || !gamma) {
    throw new Error("Expected table cells");
  }

  const nextState = indent(
    setSelection(state, {
      regionId: beta.id,
      offset: 1,
    }),
  );
  const previousState = dedent(
    setSelection(state, {
      regionId: gamma.id,
      offset: 1,
    }),
  );

  expect(nextState?.selection.focus.regionId).toBe(gamma.id);
  expect(nextState?.selection.focus.offset).toBe(1);
  expect(previousState?.selection.focus.regionId).toBe(beta.id);
  expect(previousState?.selection.focus.offset).toBe(1);
});

test("adds a new empty row when tabbing from the last table cell", () => {
  let state = createEditorState(
    parseMarkdown("| A | B |\n| --- | --- |\n| alpha | beta |\n"),
  );
  const beta = state.documentEditor.regions.find((container) => container.text === "beta");

  if (!beta) {
    throw new Error("Expected last table cell");
  }

  state = setSelection(state, {
    regionId: beta.id,
    offset: beta.text.length,
  });

  const nextState = indent(state);

  expect(nextState).toBeDefined();
  expect(serializeMarkdown(createDocumentFromEditorState(nextState!))).toBe(
    "| A     | B    |\n| ----- | ---- |\n| alpha | beta |\n|       |      |\n",
  );

  const focusedContainer = nextState!.documentEditor.regionIndex.get(
    nextState!.selection.focus.regionId,
  );

  expect(focusedContainer?.path.endsWith(".rows.2.cells.0")).toBe(true);
  expect(nextState!.selection.focus.offset).toBe(0);
});

test("does not leave the table when shift-tabbing from the first cell", () => {
  let state = createEditorState(
    parseMarkdown("| A | B |\n| --- | --- |\n| alpha | beta |\n"),
  );
  const headerA = state.documentEditor.regions.find((container) => container.text === "A");

  if (!headerA) {
    throw new Error("Expected first table cell");
  }

  state = setSelection(state, {
    regionId: headerA.id,
    offset: 0,
  });

  const nextState = dedent(state);

  expect(nextState).toBe(state);
});
