import { describe, expect, test } from "bun:test";
import {
  deleteBackward,
  deleteForward,
  deleteSelection,
  insertLineBreak,
  insertText,
  readEditorEffects,
  setSelection,
} from "@/editor/state";
import { getRegion, getRegionByType, placeAt, setup } from "../helpers";

describe("Text inserted effects", () => {
  test("emits text-inserted effects for typed text", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const result = insertText(placeAt(state, region, "end"), "!");

    expect(result).not.toBeNull();
    expect(readEditorEffects(result!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endOffset: region.text.length + 1,
          kind: "text-inserted",
          regionKind: "inlines",
          regionPath: region.path,
          startOffset: region.text.length,
          text: "!",
        }),
      ]),
    );
  });

  test("emits text-inserted effects for color emoji inserts", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const result = insertText(placeAt(state, region, "end"), "🔥");

    expect(result).not.toBeNull();
    expect(readEditorEffects(result!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "text-inserted",
          text: "🔥",
        }),
      ]),
    );
  });

  test("emits source-region text-inserted effects inside code blocks", () => {
    const state = setup("```ts\nconst value = 1;\n```\n");
    const region = getRegionByType(state, "code");
    const result = insertText(placeAt(state, region, "end"), "!");

    expect(result).not.toBeNull();
    expect(readEditorEffects(result!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endOffset: region.text.length + 1,
          kind: "text-inserted",
          regionKind: "source",
          regionPath: region.path,
          startOffset: region.text.length,
          text: "!",
        }),
      ]),
    );
  });

  test("records paired delimiter inserted range", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const result = insertText(placeAt(state, region, 2), "(");

    expect(result).not.toBeNull();
    expect(readEditorEffects(result!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endOffset: 4,
          kind: "text-inserted",
          regionKind: "inlines",
          regionPath: region.path,
          startOffset: 2,
          text: "()",
        }),
      ]),
    );
    expect(result!.selection.focus.offset).toBe(3);
  });

  test("period insertion remains semantic text insertion", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const result = insertText(placeAt(state, region, "end"), ".");

    expect(result).not.toBeNull();
    expect(readEditorEffects(result!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "text-inserted",
          startOffset: region.text.length,
          text: ".",
        }),
      ]),
    );
  });
});

describe("Text deleted effects", () => {
  test("emits text-deleted effects for backward line-end deletes", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const result = deleteBackward(placeAt(state, region, "end"));

    expect(result).not.toBeNull();
    expect(readEditorEffects(result!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: "backward",
          kind: "text-deleted",
          placement: "line-end",
          regionKind: "inlines",
          regionPath: region.path,
          startOffset: region.text.length - 1,
          text: "a",
          textKind: "plain",
        }),
      ]),
    );
  });

  test("emits forward and middle placement for deletes that default renderer will not animate", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const forward = deleteForward(placeAt(state, region, 0));
    const middle = deleteBackward(placeAt(state, region, 2));

    expect(forward).not.toBeNull();
    expect(middle).not.toBeNull();
    expect(readEditorEffects(forward!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: "forward",
          kind: "text-deleted",
          placement: "line-middle",
          text: "a",
        }),
      ]),
    );
    expect(readEditorEffects(middle!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: "backward",
          kind: "text-deleted",
          placement: "line-middle",
          text: "l",
        }),
      ]),
    );
  });

  test("marks backward deletes immediately before a soft break", () => {
    const state = setup("foo<br>bar\n");
    const region = getRegion(state, "foo\nbar");
    const result = deleteBackward(placeAt(state, region, 3));

    expect(result).not.toBeNull();
    expect(readEditorEffects(result!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "text-deleted",
          placement: "soft-line-break",
          startOffset: 2,
          text: "o",
        }),
      ]),
    );
  });

  test("emits styled text kind for non-plain deleted text", () => {
    const state = setup("**bold**\n");
    const region = getRegion(state, "bold");
    const result = deleteBackward(placeAt(state, region, "end"));

    expect(result).not.toBeNull();
    expect(readEditorEffects(result!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "text-deleted",
          text: "d",
          textKind: "styled",
        }),
      ]),
    );
  });

  test("does not emit text-deleted for selection deletes", () => {
    let state = setup("alpha\n");
    const region = getRegion(state, "alpha");

    state = setSelection(state, {
      anchor: { regionId: region.id, offset: 1 },
      focus: { regionId: region.id, offset: 4 },
    });
    const result = deleteSelection(state);

    expect(result).not.toBeNull();
    expect(readEditorEffects(result!).some((effect) => effect.kind === "text-deleted")).toBe(false);
  });

  test("emits source-region text-deleted effects inside code blocks", () => {
    const state = setup("```ts\nconst value = 1;\n```\n");
    const region = getRegionByType(state, "code");
    const result = deleteBackward(placeAt(state, region, "end"));

    expect(result).not.toBeNull();
    expect(readEditorEffects(result!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: "backward",
          kind: "text-deleted",
          regionKind: "source",
          regionPath: region.path,
          startOffset: region.text.length - 1,
          text: ";",
          textKind: "plain",
        }),
      ]),
    );
  });
});

describe("Active block changed effects", () => {
  test("emits active-block-changed when selection moves into a different block", () => {
    const state = setup("alpha\n\nbeta\n");
    const [first, second] = state.documentIndex.regions;

    if (!first || !second) throw new Error("Expected two paragraph regions");

    const stateAtFirst = setSelection(state, { regionId: first.id, offset: 0 });
    const stateAtSecond = setSelection(stateAtFirst, { regionId: second.id, offset: 0 });

    expect(readEditorEffects(stateAtSecond)).toEqual([
      expect.objectContaining({ blockPath: "root.1", kind: "active-block-changed" }),
    ]);
  });

  test("emits active-block-changed when selection moves into a different table cell", () => {
    const state = setup("| A | B |\n| - | - |\n| one | two |\n");
    const [first, second] = state.documentIndex.regions;

    if (!first || !second) throw new Error("Expected table cell regions");

    const stateAtFirst = setSelection(state, { regionId: first.id, offset: 0 });
    const stateAtSecond = setSelection(stateAtFirst, { regionId: second.id, offset: 0 });

    expect(readEditorEffects(stateAtSecond)).toEqual([
      expect.objectContaining({ blockPath: "root.0", kind: "active-block-changed" }),
    ]);
  });
});

describe("List item inserted effects", () => {
  test("emits list-item-inserted when splitting a list item with insertLineBreak", () => {
    const state = setup("- alpha\n");
    const region = getRegion(state, "alpha");
    const result = insertLineBreak(placeAt(state, region, "end"));

    expect(result).not.toBeNull();
    expect(readEditorEffects(result!)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "list-item-inserted" })]),
    );
  });

  test("orders edit effects before derived selection effects", () => {
    const state = setup("- alpha\n");
    const region = getRegion(state, "alpha");
    const result = insertLineBreak(placeAt(state, region, "end"));

    expect(result).not.toBeNull();
    expect(readEditorEffects(result!).map((effect) => effect.kind)).toEqual([
      "list-item-inserted",
      "active-block-changed",
    ]);
  });

  test("does not emit list-item-inserted when typing inside an existing list item", () => {
    const state = setup("- alpha\n");
    const result = insertText(placeAt(state, getRegion(state, "alpha"), "end"), "b");

    expect(result).not.toBeNull();
    expect(readEditorEffects(result!).some((effect) => effect.kind === "list-item-inserted")).toBe(
      false,
    );
  });

  test("emits list-item-inserted when splitting a task list item", () => {
    const state = setup("- [ ] task\n");
    const result = insertLineBreak(placeAt(state, getRegion(state, "task"), "end"));

    expect(result).not.toBeNull();
    expect(readEditorEffects(result!).some((effect) => effect.kind === "list-item-inserted")).toBe(
      true,
    );
  });
});
