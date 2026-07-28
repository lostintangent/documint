import { describe, expect, test } from "bun:test";
import { deleteWordBackward, deleteWordForward, redo, setSelection, undo } from "@/editor";
import { indexedTextEntries } from "@test/editor/helpers";
import { getPath, placeAt, setup, toMarkdown } from "./helpers";

describe("Word deletion", () => {
  test("deletes words backward and forward within one path", () => {
    const state = setup("alpha beta gamma");
    const path = getPath(state, "alpha beta gamma");
    const backward = deleteWordBackward(placeAt(state, path, "alpha beta".length));
    const forward = deleteWordForward(placeAt(state, path, "alpha".length));

    expect(indexedTextEntries(backward!)[0]?.text).toBe("alpha  gamma");
    expect(indexedTextEntries(forward!)[0]?.text).toBe("alpha gamma");
  });

  test("deletes an existing selection regardless of direction", () => {
    const state = setup("alpha beta");
    const path = getPath(state, "alpha beta");
    const selected = setSelection(state, {
      anchor: { path: path.path, offset: 0 },
      focus: { path: path.path, offset: "alpha".length },
    });

    expect(indexedTextEntries(deleteWordBackward(selected)!)[0]?.text).toBe(" beta");
    expect(indexedTextEntries(deleteWordForward(selected)!)[0]?.text).toBe(" beta");
  });

  test("deletes inline objects as atomic units", () => {
    const state = setup("before ![alt](https://example.com/image.png) after");
    const path = getPath(state, `before \uFFFC after`);
    const objectEnd = path.text.indexOf("\uFFFC") + 1;
    const nextState = deleteWordBackward(placeAt(state, path, objectEnd));

    expect(toMarkdown(nextState!)).toBe("before  after\n");
  });

  test("deletes across ordinary paths but not table-cell boundaries", () => {
    const state = setup("alpha\n\nbeta");
    const beta = getPath(state, "beta");
    const deleted = deleteWordBackward(placeAt(state, beta, "start"));

    expect(toMarkdown(deleted!)).toBe("beta\n");

    const tableState = setup("| alpha | beta |\n| --- | --- |");
    const tableBeta = getPath(tableState, "beta");

    expect(deleteWordBackward(placeAt(tableState, tableBeta, "start"))).toBeNull();
  });

  test("does not cross code or raw block boundaries", () => {
    const codeState = setup("alpha\n\n```\ncode line\n```\n\nomega");
    const alpha = getPath(codeState, "alpha");
    const code = getPath(codeState, "code line");
    const omega = getPath(codeState, "omega");

    expect(deleteWordForward(placeAt(codeState, alpha, "end"))).toBeNull();
    expect(deleteWordBackward(placeAt(codeState, code, "start"))).toBeNull();
    expect(deleteWordForward(placeAt(codeState, code, "end"))).toBeNull();
    expect(deleteWordBackward(placeAt(codeState, omega, "start"))).toBeNull();

    const rawState = setup("alpha\n\n<div>\nraw source\n</div>\n\nomega");
    const raw = getPath(rawState, "<div>");

    expect(deleteWordBackward(placeAt(rawState, raw, "start"))).toBeNull();
    expect(deleteWordForward(placeAt(rawState, raw, "end"))).toBeNull();
  });

  test("deletes words within table cells", () => {
    const state = setup("| alpha beta | gamma |\n| --- | --- |");
    const cell = getPath(state, "alpha beta");
    const nextState = deleteWordBackward(placeAt(state, cell, "end"));

    expect(toMarkdown(nextState!)).toContain("| alpha | gamma |");
  });

  test("records word deletion as one undoable mutation from the original caret", () => {
    const state = setup("alpha beta");
    const path = getPath(state, "alpha beta");
    const placed = placeAt(state, path, "end");
    const deleted = deleteWordBackward(placed);
    const restored = undo(deleted!);
    const redone = redo(restored!);

    expect(indexedTextEntries(deleted!)[0]?.text).toBe("alpha ");
    expect(toMarkdown(restored!)).toBe("alpha beta\n");
    expect(restored!.selection).toEqual(placed.selection);
    expect(indexedTextEntries(redone!)[0]?.text).toBe("alpha ");
  });

  test("does nothing at document boundaries", () => {
    const state = setup("alpha");
    const path = getPath(state, "alpha");

    expect(deleteWordBackward(placeAt(state, path, "start"))).toBeNull();
    expect(deleteWordForward(placeAt(state, path, "end"))).toBeNull();
  });
});
