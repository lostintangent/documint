import { describe, expect, test } from "bun:test";
import {
  deleteBackward,
  deleteForward,
  getEditorAnimationDuration,
  hasRunningEditorAnimations as hasRunningAnimations,
  insertLineBreak,
  insertText,
  setSelection,
} from "@/editor/state";
import { getRegion, getRegionByType, placeAt, setup } from "../../helpers";

describe("Text highlights", () => {
  test("starts and expires text highlight animations for typed text", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const stateAtEnd = placeAt(state, region, "end");
    const result = insertText(stateAtEnd, "!");

    expect(result).not.toBeNull();
    expect(result!.animations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endOffset: region.text.length + 1,
          kind: "text-highlight",
          regionPath: region.path,
          startOffset: region.text.length,
        }),
      ]),
    );

    const effect = result!.animations.find((a) => a.kind === "text-highlight");

    expect(effect).toBeDefined();
    expect(hasRunningAnimations(result!, effect!.startedAt + 10)).toBe(true);
    expect(
      hasRunningAnimations(result!, effect!.startedAt + getEditorAnimationDuration(effect!) + 10),
    ).toBe(false);
  });

  test("highlights both delimiters for paired delimiter insertion", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const result = insertText(placeAt(state, region, 2), "(");

    expect(result).not.toBeNull();
    expect(result!.animations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endOffset: 4,
          kind: "text-highlight",
          regionPath: region.path,
          startOffset: 2,
        }),
      ]),
    );
    expect(result!.selection.focus.offset).toBe(3);
  });

  test("does not start text highlight animations for color emoji inserts", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const stateAtEnd = placeAt(state, region, "end");
    const result = insertText(stateAtEnd, "🔥");

    expect(result).not.toBeNull();
    expect(result!.animations.some((animation) => animation.kind === "text-highlight")).toBe(false);
  });

  test("does not start text highlight animations inside code blocks", () => {
    const state = setup("```ts\nconst value = 1;\n```\n");
    const region = getRegionByType(state, "code");
    const result = insertText(placeAt(state, region, "end"), "!");

    expect(result).not.toBeNull();
    expect(result!.animations.some((animation) => animation.kind === "text-highlight")).toBe(false);
  });
});

describe("Text pulses", () => {
  test("starts a text pulse animation when typing a period", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const stateAtEnd = placeAt(state, region, "end");
    const result = insertText(stateAtEnd, ".");

    expect(result).not.toBeNull();
    expect(result!.animations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "text-pulse",
          offset: region.text.length,
          regionPath: region.path,
        }),
      ]),
    );

    const pulse = result!.animations.find((a) => a.kind === "text-pulse");
    const stateWithPulseOnly = { ...result!, animations: pulse ? [pulse] : [] };

    expect(pulse).toBeDefined();
    expect(hasRunningAnimations(stateWithPulseOnly, pulse!.startedAt + 10)).toBe(true);
    expect(
      hasRunningAnimations(
        stateWithPulseOnly,
        pulse!.startedAt + getEditorAnimationDuration(pulse!) + 10,
      ),
    ).toBe(false);
  });

  test("does not start text pulse animations inside code blocks", () => {
    const state = setup("```ts\nconst value = 1;\n```\n");
    const region = getRegionByType(state, "code");
    const result = insertText(placeAt(state, region, "end"), ".");

    expect(result).not.toBeNull();
    expect(result!.animations.some((animation) => animation.kind === "text-pulse")).toBe(false);
  });

  test("does not start a text pulse animation for ordinary text input", () => {
    const state = setup("alpha\n");
    const result = insertText(placeAt(state, getRegion(state, "alpha"), "end"), "a");

    expect(result).not.toBeNull();
    expect(result!.animations.some((a) => a.kind === "text-pulse")).toBe(false);
  });
});

describe("Text fades", () => {
  test("starts and expires text fade animations for single-character deletes", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const stateAtEnd = placeAt(state, region, "end");
    const result = deleteBackward(stateAtEnd);

    expect(result).not.toBeNull();
    expect(result!.animations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "text-fade",
          regionPath: region.path,
          startOffset: region.text.length - 1,
          text: "a",
        }),
      ]),
    );

    const animation = result!.animations.find((a) => a.kind === "text-fade");
    const stateWithFadeOnly = { ...result!, animations: animation ? [animation] : [] };

    expect(animation).toBeDefined();
    expect(hasRunningAnimations(stateWithFadeOnly, animation!.startedAt + 10)).toBe(true);
    expect(
      hasRunningAnimations(
        stateWithFadeOnly,
        animation!.startedAt + getEditorAnimationDuration(animation!) + 10,
      ),
    ).toBe(false);
  });

  test("does not start text fade animations for forward deletes", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const result = deleteForward(placeAt(state, region, 0));

    expect(result).not.toBeNull();
    expect(result!.animations.some((animation) => animation.kind === "text-fade")).toBe(false);
  });

  test("does not start text fade animations for backward deletes with trailing text", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const result = deleteBackward(placeAt(state, region, 2));

    expect(result).not.toBeNull();
    expect(result!.animations.some((animation) => animation.kind === "text-fade")).toBe(false);
  });

  test("starts text fade animations for backward deletes immediately before a soft break", () => {
    const state = setup("foo<br>bar\n");
    const region = getRegion(state, "foo\nbar");
    const result = deleteBackward(placeAt(state, region, 3));

    expect(result).not.toBeNull();
    expect(result!.animations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "text-fade",
          regionPath: region.path,
          startOffset: 2,
          text: "o",
        }),
      ]),
    );
  });

  test("does not start text fade animations when backspace removes a soft break", () => {
    const state = setup("foo<br>bar\n");
    const region = getRegion(state, "foo\nbar");
    const result = deleteBackward(placeAt(state, region, 4));

    expect(result).not.toBeNull();
    expect(result!.animations.some((animation) => animation.kind === "text-fade")).toBe(false);
  });

  test("does not start text fade animations for color emoji deletes", () => {
    const state = setup("alpha 🔥\n");
    const region = getRegion(state, "alpha 🔥");
    const stateAtEnd = placeAt(state, region, "end");
    const result = deleteBackward(stateAtEnd);

    expect(result).not.toBeNull();
    expect(result!.animations.some((animation) => animation.kind === "text-fade")).toBe(false);
  });
});

describe("Active block flash", () => {
  test("starts an active-block flash animation when selection moves into a different block", () => {
    const state = setup("alpha\n\nbeta\n");
    const [first, second] = state.documentIndex.regions;

    if (!first || !second) throw new Error("Expected two paragraph regions");

    const stateAtFirst = setSelection(state, { regionId: first.id, offset: 0 });
    const stateAtSecond = setSelection(stateAtFirst, { regionId: second.id, offset: 0 });

    expect(stateAtSecond.animations).toEqual([
      expect.objectContaining({ blockPath: "root.1", kind: "active-block-flash" }),
    ]);
  });

  test("starts an active-block flash animation when selection moves into a different table cell", () => {
    const state = setup("| A | B |\n| - | - |\n| one | two |\n");
    const [first, second] = state.documentIndex.regions;

    if (!first || !second) throw new Error("Expected table cell regions");

    const stateAtFirst = setSelection(state, { regionId: first.id, offset: 0 });
    const stateAtSecond = setSelection(stateAtFirst, { regionId: second.id, offset: 0 });

    expect(stateAtSecond.animations).toEqual([
      expect.objectContaining({ blockPath: "root.0", kind: "active-block-flash" }),
    ]);
  });
});

describe("Block pulses", () => {
  test("starts a block-pulse animation when splitting a list item with insertLineBreak", () => {
    const state = setup("- alpha\n");
    const region = getRegion(state, "alpha");
    const stateAtEnd = placeAt(state, region, "end");
    const result = insertLineBreak(stateAtEnd);

    expect(result).not.toBeNull();
    expect(result!.animations).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "block-pulse" })]),
    );
  });

  test("does not re-trigger block-pulse when typing inside an existing list item", () => {
    const state = setup("- alpha\n");
    const result = insertText(placeAt(state, getRegion(state, "alpha"), "end"), "b");

    expect(result).not.toBeNull();
    expect(result!.animations.some((a) => a.kind === "block-pulse")).toBe(false);
  });

  test("does not start a block-pulse animation when splitting a task list item", () => {
    const state = setup("- [ ] task\n");
    const result = insertLineBreak(placeAt(state, getRegion(state, "task"), "end"));

    expect(result).not.toBeNull();
    expect(result!.animations.some((a) => a.kind === "block-pulse")).toBe(false);
  });
});
