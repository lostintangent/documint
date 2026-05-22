import { expect, test } from "bun:test";
import { resolveEditorInputCommand, type EditorInputKeybinding } from "@/component/lib/keybindings";

// --- Modifier shortcuts ---
// Each row is `[label, key, modifiers, expectedCommand]`. The label is the
// only thing surfaced in the test name; the modifier object is consumed by
// `createKeyboardEvent` so the test body stays uniform.
test.each([
  ["bold", "b", { metaKey: true }, "toggleBold"],
  ["italic", "i", { metaKey: true }, "toggleItalic"],
  ["underline", "u", { metaKey: true }, "toggleUnderline"],
  ["superscript", ".", { metaKey: true }, "toggleSuperscript"],
  ["inline code", "e", { metaKey: true }, "toggleCode"],
  ["move list item up", "ArrowUp", { altKey: true, shiftKey: true }, "moveListItemUp"],
  ["move list item down", "ArrowDown", { altKey: true, shiftKey: true }, "moveListItemDown"],
  ["undo", "z", { metaKey: true }, "undo"],
  ["redo via meta+shift+z", "z", { metaKey: true, shiftKey: true }, "redo"],
  ["redo via ctrl+y", "y", { ctrlKey: true }, "redo"],
] as const)("resolves the modifier shortcut for %s", (_label, key, modifiers, command) => {
  expect(resolveEditorInputCommand(createKeyboardEvent(key, modifiers))).toBe(command);
});

// --- Structural keys ---
test.each([
  ["Enter", "Enter", {}, "insertLineBreak"],
  ["Backspace", "Backspace", {}, "deleteBackward"],
  ["Home", "Home", {}, "moveToLineStart"],
  ["End", "End", {}, "moveToLineEnd"],
  ["Tab", "Tab", {}, "indent"],
  ["Shift+Tab", "Tab", { shiftKey: true }, "dedent"],
  ["meta+ArrowLeft", "ArrowLeft", { metaKey: true }, "moveToLineStart"],
  ["meta+ArrowRight", "ArrowRight", { metaKey: true }, "moveToLineEnd"],
  ["meta+shift+ArrowLeft", "ArrowLeft", { metaKey: true, shiftKey: true }, "moveToLineStart"],
  ["meta+shift+ArrowRight", "ArrowRight", { metaKey: true, shiftKey: true }, "moveToLineEnd"],
] as const)("resolves the structural key %s", (_label, key, modifiers, command) => {
  expect(resolveEditorInputCommand(createKeyboardEvent(key, modifiers))).toBe(command);
});

// --- Unsupported shortcuts return null ---
test.each([
  ["meta+x has no mapping", "x", { metaKey: true }],
  ["plain `b` without a modifier is not toggleBold", "b", {}],
] as const)("returns null when %s", (_label, key, modifiers) => {
  expect(resolveEditorInputCommand(createKeyboardEvent(key, modifiers))).toBeNull();
});

test("resolves commands against a caller-provided keybinding set", () => {
  const keybindings: EditorInputKeybinding[] = [
    {
      command: "toggleBold",
      key: "k",
      modKey: true,
    },
  ];

  expect(resolveEditorInputCommand(createKeyboardEvent("k", { metaKey: true }), keybindings)).toBe(
    "toggleBold",
  );
  expect(
    resolveEditorInputCommand(createKeyboardEvent("b", { metaKey: true }), keybindings),
  ).toBeNull();
});

function createKeyboardEvent(
  key: string,
  options: {
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  } = {},
) {
  return {
    altKey: options.altKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    key,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
  } as KeyboardEvent;
}
