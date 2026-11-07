import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import { tableCellPathContextFromPath } from "@/document";
import {
  dedent,
  deleteBackward,
  deleteForward,
  deleteTable,
  deleteTableColumn,
  deleteTableRow,
  indent,
  insertText,
  insertTable,
  insertTableColumn,
  insertTableRow,
  setSelection,
} from "@/editor/state";
import { getPath, placeAt, setup, toMarkdown } from "../../helpers";

describe("Table navigation", () => {
  test.each([
    ["tab", "the next cell", indent, "alpha", 2, "beta", 2],
    ["shift-tab", "the previous cell", dedent, "beta", 2, "alpha", 2],
    ["tab", "the next row", indent, "beta", 1, "gamma", 1],
    ["shift-tab", "the previous row", dedent, "gamma", 1, "beta", 1],
    ["tab", "a shorter cell, clamping the offset", indent, "alpha", 5, "beta", 4],
  ] as const)("%s moves to %s", (_, __, command, from, offset, to, expectedOffset) => {
    const state = setup("| A | B |\n| --- | --- |\n| alpha | beta |\n| gamma | delta |\n");
    const point = { path: getPath(state, to).path, offset: expectedOffset };

    expect(command(placeAt(state, getPath(state, from), offset))?.selection).toEqual({
      anchor: point,
      focus: point,
    });
  });

  test("adds a new empty row when tabbing from the last table cell", () => {
    let state = setup("| A | B |\n| --- | --- |\n| alpha | beta |\n");
    const beta = getPath(state, "beta");

    state = placeAt(state, beta, beta.text.length);

    const nextState = indent(state);

    expect(nextState).toBeDefined();
    expect(toMarkdown(nextState!)).toBe("| A | B |\n| --- | --- |\n| alpha | beta |\n|  |  |\n");

    expect(tableCellPathContextFromPath(nextState!.selection.focus.path)).toMatchObject({
      cellIndex: 0,
      rowIndex: 2,
    });
    expect(nextState!.selection.focus.offset).toBe(0);
  });

  test("does not leave the table when shift-tabbing from the first cell", () => {
    let state = setup("| A | B |\n| --- | --- |\n| alpha | beta |\n");
    const headerA = getPath(state, "A");

    state = placeAt(state, headerA, 0);

    const nextState = dedent(state);

    expect(nextState).toBe(state);
  });

  test("does not structurally delete an empty table cell at either boundary", () => {
    const state = setup("before\n\n| A | B |\n| --- | --- |\n| C |  |\n\nafter");
    const emptyCell = requireTableCellPath(state, 1, 1);
    const placed = setSelection(state, { offset: 0, path: emptyCell });

    expect(deleteBackward(placed)).toBeNull();
    expect(deleteForward(placed)).toBeNull();
    expect(toMarkdown(placed)).toBe("before\n\n| A | B |\n| --- | --- |\n| C |  |\n\nafter\n");
  });
});

function stateWithTable() {
  const state = setup("");
  const path = getPath(state, "");
  return insertTable(placeAt(state, path, "start"), 2)!;
}

function inFirstCell(state: ReturnType<typeof stateWithTable>) {
  const path = indexedTextEntries(state).find((r) => r.tableCell != null)!;
  return placeAt(state, path, "start");
}

function requireTableCellPath(
  state: ReturnType<typeof setup>,
  rowIndex: number,
  cellIndex: number,
) {
  const table = state.documentIndex.blocks.find((entry) => entry.kind === "cells");
  const cell = table?.tableCellRows[rowIndex]?.[cellIndex];

  if (!cell) {
    throw new Error(`Expected table cell at ${rowIndex}:${cellIndex}`);
  }

  return cell.path;
}

describe("Table insertion", () => {
  test("inserts a table with the requested column count", () => {
    const state = stateWithTable();

    expect(toMarkdown(state)).toContain("|");
    expect(
      indexedTextEntries(state).filter((entry) => entry.tableCell != null).length,
    ).toBeGreaterThanOrEqual(2);
    expect(state.selection.focus.path).toBe(requireTableCellPath(state, 0, 0));
  });
});

describe("Table structure", () => {
  test("keeps cached table cell plain text canonical after a text edit", () => {
    let state = setup("| A | B |\n| --- | --- |\n| one | two |\n");
    const one = getPath(state, "one");

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
    expect(next!.selection.focus.path).toBe(requireTableCellPath(next!, 0, 1));
  });

  test("inserts a column to the left of the current cell", () => {
    const before = toMarkdown(stateWithTable()).split("|").length;
    const next = insertTableColumn(inFirstCell(stateWithTable()), "left");

    expect(next).not.toBeNull();
    expect(toMarkdown(next!).split("|").length).toBeGreaterThan(before);
    expect(next!.selection.focus.path).toBe(requireTableCellPath(next!, 0, 0));
  });

  test("inserts a row above the current row", () => {
    const before = toMarkdown(stateWithTable()).split("\n").length;
    const next = insertTableRow(inFirstCell(stateWithTable()), "above");

    expect(next).not.toBeNull();
    expect(toMarkdown(next!).split("\n").length).toBeGreaterThan(before);
    expect(next!.selection.focus.path).toBe(requireTableCellPath(next!, 0, 0));
  });

  test("inserts a row below the current row", () => {
    const before = toMarkdown(stateWithTable()).split("\n").length;
    const next = insertTableRow(inFirstCell(stateWithTable()), "below");

    expect(next).not.toBeNull();
    expect(toMarkdown(next!).split("\n").length).toBeGreaterThan(before);
    expect(next!.selection.focus.path).toBe(requireTableCellPath(next!, 1, 0));
  });

  test("keeps selection inside a nested table after inserting a row", () => {
    let state = setup("> | A | B |\n> | - | - |\n> | one | two |\n");
    const one = getPath(state, "one");

    state = placeAt(state, one, "start");

    const next = insertTableRow(state, "below");

    expect(next).not.toBeNull();
    expect(tableCellPathContextFromPath(next!.selection.focus.path)).toMatchObject({
      cellIndex: 0,
      rowIndex: 2,
    });
  });

  test("deletes the current column", () => {
    const state = stateWithTable();
    const withExtra = insertTableColumn(inFirstCell(state), "right")!;
    const before = toMarkdown(withExtra).split("|").length;
    const next = deleteTableColumn(inFirstCell(withExtra));

    expect(next).not.toBeNull();
    expect(toMarkdown(next!).split("|").length).toBeLessThan(before);
  });

  test.each([
    [
      "the last column",
      "| a | b |\n| - | - |\n| d | e |\n",
      "e",
      deleteTableColumn,
      "| a |\n| --- |\n| Xd |\n",
    ],
    ["the last row", "| a |\n| - |\n| b |\n", "b", deleteTableRow, "| Xa |\n| --- |\n"],
  ])("typing after deleting %s lands in a real cell", (_, source, text, command, expected) => {
    const state = setup(source);
    const deleted = command(placeAt(state, getPath(state, text), "end"))!;

    expect(toMarkdown(insertText(deleted, "X")!)).toBe(expected);
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
    const path = getPath(state, "just text");
    const placed = placeAt(state, path, "start");

    expect(insertTableColumn(placed, "right")).toBeNull();
    expect(deleteTable(placed)).toBeNull();
  });
});
