import { expect, test } from "bun:test";
import {
  dedent,
  deleteTable,
  deleteTableColumn,
  deleteTableRow,
  indent,
  insertTable,
  insertTableColumn,
  insertTableRow,
} from "@/editor/state";
import { createDocumentFromEditorState, createEditorState, setSelection } from "@/editor/state";
import { parseMarkdown, serializeMarkdown } from "@/markdown";
import { getRegion, placeAt, setup, toMarkdown } from "../helpers";

test("moves to the next and previous table cell with tab and shift-tab", () => {
  let state = createEditorState(parseMarkdown("| A | B |\n| --- | --- |\n| alpha | beta |\n"));
  const alpha = state.documentIndex.regions.find((container) => container.text === "alpha");

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
    state.documentIndex.regions.find((container) => container.text === "beta")!.id,
  );
  expect(nextState?.selection.focus.offset).toBe(2);
  expect(previousState?.selection.focus.regionId).toBe(alpha.id);
  expect(previousState?.selection.focus.offset).toBe(2);
});

test("moves across table rows with tab and shift-tab", () => {
  let state = createEditorState(
    parseMarkdown("| A | B |\n| --- | --- |\n| alpha | beta |\n| gamma | delta |\n"),
  );
  const beta = state.documentIndex.regions.find((container) => container.text === "beta");
  const gamma = state.documentIndex.regions.find((container) => container.text === "gamma");

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
  let state = createEditorState(parseMarkdown("| A | B |\n| --- | --- |\n| alpha | beta |\n"));
  const beta = state.documentIndex.regions.find((container) => container.text === "beta");

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
    "| A | B |\n| --- | --- |\n| alpha | beta |\n|  |  |\n",
  );

  const focusedContainer = nextState!.documentIndex.regionIndex.get(
    nextState!.selection.focus.regionId,
  );

  expect(focusedContainer?.path.endsWith(".rows.2.cells.0")).toBe(true);
  expect(nextState!.selection.focus.offset).toBe(0);
});

test("does not leave the table when shift-tabbing from the first cell", () => {
  let state = createEditorState(parseMarkdown("| A | B |\n| --- | --- |\n| alpha | beta |\n"));
  const headerA = state.documentIndex.regions.find((container) => container.text === "A");

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

// --- Structural operations ---

function stateWithTable() {
  const state = setup("");
  const region = getRegion(state, "");
  return insertTable(placeAt(state, region, "start"), 2)!;
}

function inFirstCell(state: ReturnType<typeof stateWithTable>) {
  const region = state.documentIndex.regions.find((r) => r.tableCellPosition != null)!;
  return placeAt(state, region, "start");
}

test("inserts a table with the requested column count", () => {
  expect(toMarkdown(stateWithTable())).toContain("|");
  expect(stateWithTable().documentIndex.regions.filter((r) => r.tableCellPosition != null).length).toBeGreaterThanOrEqual(2);
});

test("inserts a column to the right of the current cell", () => {
  const before = toMarkdown(stateWithTable()).split("|").length;
  const next = insertTableColumn(inFirstCell(stateWithTable()), "right");

  expect(next).not.toBeNull();
  expect(toMarkdown(next!).split("|").length).toBeGreaterThan(before);
});

test("inserts a column to the left of the current cell", () => {
  const before = toMarkdown(stateWithTable()).split("|").length;
  const next = insertTableColumn(inFirstCell(stateWithTable()), "left");

  expect(next).not.toBeNull();
  expect(toMarkdown(next!).split("|").length).toBeGreaterThan(before);
});

test("inserts a row above the current row", () => {
  const before = toMarkdown(stateWithTable()).split("\n").length;
  const next = insertTableRow(inFirstCell(stateWithTable()), "above");

  expect(next).not.toBeNull();
  expect(toMarkdown(next!).split("\n").length).toBeGreaterThan(before);
});

test("inserts a row below the current row", () => {
  const before = toMarkdown(stateWithTable()).split("\n").length;
  const next = insertTableRow(inFirstCell(stateWithTable()), "below");

  expect(next).not.toBeNull();
  expect(toMarkdown(next!).split("\n").length).toBeGreaterThan(before);
});

test("deletes the current column", () => {
  const state = stateWithTable();
  const withExtra = insertTableColumn(inFirstCell(state), "right")!;
  const before = toMarkdown(withExtra).split("|").length;
  const next = deleteTableColumn(inFirstCell(withExtra));

  expect(next).not.toBeNull();
  expect(toMarkdown(next!).split("|").length).toBeLessThan(before);
});

test("deletes the current row", () => {
  const state = stateWithTable();
  const withExtra = insertTableRow(inFirstCell(state), "below")!;
  const before = toMarkdown(withExtra).split("\n").length;
  const next = deleteTableRow(inFirstCell(withExtra));

  expect(next).not.toBeNull();
  expect(toMarkdown(next!).split("\n").length).toBeLessThan(before);
});

test("deletes the entire table", () => {
  const state = stateWithTable();
  const next = deleteTable(inFirstCell(state));

  expect(next).not.toBeNull();
  expect(toMarkdown(next!)).not.toContain("|");
});

test("returns null for table structural commands when selection is outside a table", () => {
  const state = setup("just text\n");
  const region = getRegion(state, "just text");
  const placed = placeAt(state, region, "start");

  expect(insertTableColumn(placed, "right")).toBeNull();
  expect(deleteTable(placed)).toBeNull();
});
