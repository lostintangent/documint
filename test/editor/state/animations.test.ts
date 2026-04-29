import { expect, test } from "bun:test";
import {
  createEditorState,
  deleteBackward,
  hasNewAnimation,
  insertLineBreak,
  insertText,
  setSelection,
} from "@/editor/state";
import { getEditorAnimationDuration, hasRunningEditorAnimations as hasRunningAnimations } from "@/editor/canvas/animations";
import { parseMarkdown } from "@/markdown";
import { getRegion, placeAt, setup } from "./helpers";

test("starts and expires inserted-text highlight animations for typed text", () => {
  const state = setup("alpha\n");
  const region = getRegion(state, "alpha");
  const stateAtEnd = placeAt(state, region, "end");
  const result = insertText(stateAtEnd, "!");

  expect(result).not.toBeNull();
  expect(hasNewAnimation(stateAtEnd, result!)).toBe(true);
  expect(result!.animations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        endOffset: region.text.length + 1,
        kind: "inserted-text-highlight",
        regionPath: region.path,
        startOffset: region.text.length,
      }),
    ]),
  );

  const effect = result!.animations.find((a) => a.kind === "inserted-text-highlight");

  expect(effect).toBeDefined();
  expect(hasRunningAnimations(result!, effect!.startedAt + 10)).toBe(true);
  expect(hasRunningAnimations(result!, effect!.startedAt + getEditorAnimationDuration(effect!) + 10)).toBe(false);
});

test("starts a punctuation pulse animation when typing a period", () => {
  const state = setup("alpha\n");
  const region = getRegion(state, "alpha");
  const stateAtEnd = placeAt(state, region, "end");
  const result = insertText(stateAtEnd, ".");

  expect(result).not.toBeNull();
  expect(hasNewAnimation(stateAtEnd, result!)).toBe(true);
  expect(result!.animations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "punctuation-pulse",
        offset: region.text.length,
        regionPath: region.path,
      }),
    ]),
  );

  const pulse = result!.animations.find((a) => a.kind === "punctuation-pulse");
  const stateWithPulseOnly = { ...result!, animations: pulse ? [pulse] : [] };

  expect(pulse).toBeDefined();
  expect(hasRunningAnimations(stateWithPulseOnly, pulse!.startedAt + 10)).toBe(true);
  expect(hasRunningAnimations(stateWithPulseOnly, pulse!.startedAt + getEditorAnimationDuration(pulse!) + 10)).toBe(false);
});

test("does not start a punctuation pulse animation for ordinary text input", () => {
  const state = setup("alpha\n");
  const result = insertText(placeAt(state, getRegion(state, "alpha"), "end"), "a");

  expect(result).not.toBeNull();
  expect(result!.animations.some((a) => a.kind === "punctuation-pulse")).toBe(false);
});

test("starts and expires deleted-text fade animations for single-character deletes", () => {
  const state = setup("alpha\n");
  const region = getRegion(state, "alpha");
  const stateAtEnd = placeAt(state, region, "end");
  const result = deleteBackward(stateAtEnd);

  expect(result).not.toBeNull();
  expect(hasNewAnimation(stateAtEnd, result!)).toBe(true);
  expect(result!.animations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "deleted-text-fade",
        regionPath: region.path,
        startOffset: region.text.length - 1,
        text: "a",
      }),
    ]),
  );

  const animation = result!.animations.find((a) => a.kind === "deleted-text-fade");
  const stateWithFadeOnly = { ...result!, animations: animation ? [animation] : [] };

  expect(animation).toBeDefined();
  expect(hasRunningAnimations(stateWithFadeOnly, animation!.startedAt + 10)).toBe(true);
  expect(hasRunningAnimations(stateWithFadeOnly, animation!.startedAt + getEditorAnimationDuration(animation!) + 10)).toBe(false);
});

test("starts an active-block flash animation when selection moves into a different block", () => {
  const state = createEditorState(parseMarkdown("alpha\n\nbeta\n"));
  const [first, second] = state.documentIndex.regions;

  if (!first || !second) throw new Error("Expected two paragraph regions");

  const stateAtFirst = setSelection(state, { regionId: first.id, offset: 0 });
  const stateAtSecond = setSelection(stateAtFirst, { regionId: second.id, offset: 0 });

  expect(hasNewAnimation(stateAtFirst, stateAtSecond)).toBe(true);
  expect(stateAtSecond.animations).toEqual([
    expect.objectContaining({ blockPath: "root.1", kind: "active-block-flash" }),
  ]);
});

test("starts an active-block flash animation when selection moves into a different table cell", () => {
  const state = createEditorState(parseMarkdown("| A | B |\n| - | - |\n| one | two |\n"));
  const [first, second] = state.documentIndex.regions;

  if (!first || !second) throw new Error("Expected table cell regions");

  const stateAtFirst = setSelection(state, { regionId: first.id, offset: 0 });
  const stateAtSecond = setSelection(stateAtFirst, { regionId: second.id, offset: 0 });

  expect(hasNewAnimation(stateAtFirst, stateAtSecond)).toBe(true);
  expect(stateAtSecond.animations).toEqual([
    expect.objectContaining({ blockPath: "root.0", kind: "active-block-flash" }),
  ]);
});

test("starts a list-marker-pop animation when splitting a list item with insertLineBreak", () => {
  const state = setup("- alpha\n");
  const region = getRegion(state, "alpha");
  const stateAtEnd = placeAt(state, region, "end");
  const result = insertLineBreak(stateAtEnd);

  expect(result).not.toBeNull();
  expect(hasNewAnimation(stateAtEnd, result!)).toBe(true);
  expect(result!.animations).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "list-marker-pop" })]),
  );
});

test("does not re-trigger list-marker-pop when typing inside an existing list item", () => {
  const state = setup("- alpha\n");
  const result = insertText(placeAt(state, getRegion(state, "alpha"), "end"), "b");

  expect(result).not.toBeNull();
  expect(result!.animations.some((a) => a.kind === "list-marker-pop")).toBe(false);
});

test("does not start a list-marker-pop animation when splitting a task list item", () => {
  const state = setup("- [ ] task\n");
  const result = insertLineBreak(placeAt(state, getRegion(state, "task"), "end"));

  expect(result).not.toBeNull();
  expect(result!.animations.some((a) => a.kind === "list-marker-pop")).toBe(false);
});
