import { describe, expect, test } from "bun:test";
import { tableCellPositionFromPath } from "@/document";
import {
  dedent,
  deleteTable,
  deleteTableColumn,
  deleteTableRow,
  indent,
  insertText,
  insertTable,
  insertTableColumn,
  insertTableRow,
  resolveRegion,
} from "@/editor/state";
import { getRegion, placeAt, setup, toMarkdown } from "../../helpers";

describe("Table navigation", () => {
  test("moves to the next and previous table cell with tab and shift-tab", () => {
    let state = setup("| A | B |\n| --- | --- |\n| alpha | beta |\n");
    const alpha = getRegion(state, "alpha");

    state = placeAt(state, alpha, 2);

    const nextState = indent(state);
    const previousState = nextState ? dedent(nextState) : null;

    expect(nextState?.selection.focus.regionPath).toBe(
      state.documentIndex.regions.find((container) => container.text === "beta")!.path,
    );
    expect(nextState?.selection.focus.offset).toBe(2);
    expect(previousState?.selection.focus.regionPath).toBe(alpha.path);
    expect(previousState?.selection.focus.offset).toBe(2);
  });

  test("moves across table rows with tab and shift-tab", () => {
    let state = setup("| A | B |\n| --- | --- |\n| alpha | beta |\n| gamma | delta |\n");
    const beta = state.documentIndex.regions.find((container) => container.text === "beta");
    const gamma = state.documentIndex.regions.find((container) => container.text === "gamma");

    if (!beta || !gamma) {
      throw new Error("Expected table cells");
    }

    const nextState = indent(placeAt(state, beta, 1));
    const previousState = dedent(placeAt(state, gamma, 1));

    expect(nextState?.selection.focus.regionPath).toBe(gamma.path);
    expect(nextState?.selection.focus.offset).toBe(1);
    expect(previousState?.selection.focus.regionPath).toBe(beta.path);
    expect(previousState?.selection.focus.offset).toBe(1);
  });

  test("adds a new empty row when tabbing from the last table cell", () => {
    let state = setup("| A | B |\n| --- | --- |\n| alpha | beta |\n");
    const beta = getRegion(state, "beta");

    state = placeAt(state, beta, beta.text.length);

    const nextState = indent(state);

    expect(nextState).toBeDefined();
    expect(toMarkdown(nextState!)).toBe("| A | B |\n| --- | --- |\n| alpha | beta |\n|  |  |\n");

    const focusedContainer = resolveRegion(
      nextState!.documentIndex,
      nextState!.selection.focus.regionPath,
    );

    expect(tableCellPositionFromPath(focusedContainer?.path ?? "")).toEqual({
      cellIndex: 0,
      rowIndex: 2,
    });
    expect(nextState!.selection.focus.offset).toBe(0);
  });

  test("does not leave the table when shift-tabbing from the first cell", () => {
    let state = setup("| A | B |\n| --- | --- |\n| alpha | beta |\n");
    const headerA = getRegion(state, "A");

    state = placeAt(state, headerA, 0);

    const nextState = dedent(state);

    expect(nextState).toBe(state);
  });
});

function stateWithTable() {
  const state = setup("");
  const region = getRegion(state, "");
  return insertTable(placeAt(state, region, "start"), 2)!;
}

function inFirstCell(state: ReturnType<typeof stateWithTable>) {
  const region = state.documentIndex.regions.find((r) => r.tableCellPosition != null)!;
  return placeAt(state, region, "start");
}

describe("Table insertion", () => {
  test("inserts a table with the requested column count", () => {
    expect(toMarkdown(stateWithTable())).toContain("|");
    expect(
      stateWithTable().documentIndex.regions.filter((r) => r.tableCellPosition != null).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("Table structure", () => {
  test("keeps cached table cell plain text canonical after a text edit", () => {
    let state = setup("| A | B |\n| --- | --- |\n| one | two |\n");
    const one = getRegion(state, "one");

    state = placeAt(state, one, "end");

    const nextState = insertText(state, " edited");

    if (!nextState) {
      throw new Error("Expected insertText to produce a new state");
    }

    const table = nextState.documentIndex.document.blocks[0];

    if (table?.type !== "table") {
      throw new Error("Expected edited root to remain a table");
    }

    expect(table.rows[1]?.cells[0]?.plainText).toBe("one edited");
    expect(table.plainText).toBe("A | B\none edited | two");
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
});
