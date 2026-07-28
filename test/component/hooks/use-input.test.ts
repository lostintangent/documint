import { expect, test } from "bun:test";
import {
  INPUT_SEED,
  isReadOnlySafeInputCommand,
  isLineBreakInputType,
  resolveDeleteInputCommand,
  stripInputSeed,
} from "@/component/hooks/useInput";
import type { EditorInputCommand } from "@/types";

test("treats both paragraph and line-break input types as structural Enter", () => {
  // iOS Safari emits `insertLineBreak` for the virtual keyboard's Return
  // key regardless of modifier state, so the inputType cannot tell us
  // whether the user wanted a soft break here. Both must collapse to the
  // same structural-Enter route; soft breaks are reachable only via the
  // Shift+Enter keybinding on physical keyboards (handled by `keydown`).
  expect(isLineBreakInputType("insertParagraph")).toBe(true);
  expect(isLineBreakInputType("insertLineBreak")).toBe(true);
  expect(isLineBreakInputType("insertText")).toBe(false);
});

test("normalizes iOS-style backward delete input types", () => {
  expect(resolveDeleteInputCommand("deleteContentBackward")).toBe("deleteBackward");
  expect(resolveDeleteInputCommand("deleteComposedCharacterBackward")).toBe("deleteBackward");
  expect(resolveDeleteInputCommand("deleteSoftLineBackward")).toBe("deleteBackward");
  expect(resolveDeleteInputCommand("deleteHardLineBackward")).toBe("deleteBackward");
  expect(resolveDeleteInputCommand("deleteWordBackward")).toBe("deleteWordBackward");
});

test("normalizes forward delete input types", () => {
  expect(resolveDeleteInputCommand("deleteContentForward")).toBe("deleteForward");
  expect(resolveDeleteInputCommand("deleteSoftLineForward")).toBe("deleteForward");
  expect(resolveDeleteInputCommand("deleteHardLineForward")).toBe("deleteForward");
  expect(resolveDeleteInputCommand("deleteWordForward")).toBe("deleteWordForward");
});

test("ignores unrelated input types", () => {
  expect(resolveDeleteInputCommand("insertText")).toBeNull();
});

test("strips the hidden input seed from native text", () => {
  expect(stripInputSeed(`${INPUT_SEED}a${INPUT_SEED}b`)).toBe("ab");
  expect(stripInputSeed(INPUT_SEED)).toBe("");
});

test("classifies read-only-safe input commands declaratively", () => {
  const safeCommands = [
    "moveToDocumentEnd",
    "moveToDocumentStart",
    "moveToLineEnd",
    "moveToLineStart",
    "moveWordBackward",
    "moveWordForward",
    "selectAll",
  ] satisfies EditorInputCommand[];

  const mutatingCommands = [
    "dedent",
    "deleteBackward",
    "deleteForward",
    "deleteWordBackward",
    "deleteWordForward",
    "indent",
    "insertLineBreak",
    "insertSoftLineBreak",
    "moveListItemDown",
    "moveListItemUp",
    "redo",
    "toggleBold",
    "toggleCode",
    "toggleItalic",
    "toggleStrikethrough",
    "toggleSuperscript",
    "toggleUnderline",
    "undo",
  ] satisfies EditorInputCommand[];

  for (const command of safeCommands) {
    expect(isReadOnlySafeInputCommand(command)).toBe(true);
  }

  for (const command of mutatingCommands) {
    expect(isReadOnlySafeInputCommand(command)).toBe(false);
  }
});
