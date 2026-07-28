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
  ["strikethrough", "x", { metaKey: true, shiftKey: true }, "toggleStrikethrough"],
  ["move list item up", "ArrowUp", { altKey: true, shiftKey: true }, "moveListItemUp"],
  ["move list item down", "ArrowDown", { altKey: true, shiftKey: true }, "moveListItemDown"],
  ["undo", "z", { metaKey: true }, "undo"],
  ["redo via meta+shift+z", "z", { metaKey: true, shiftKey: true }, "redo"],
  ["redo via ctrl+y", "y", { ctrlKey: true }, "redo"],
  ["select all via meta", "a", { metaKey: true }, "selectAll"],
  ["select all via ctrl", "a", { ctrlKey: true }, "selectAll"],
] as const)("resolves the modifier shortcut for %s", (_label, key, modifiers, command) => {
  expect(resolveEditorInputCommand(createKeyboardEvent(key, modifiers))).toBe(command);
});

// --- Structural keys ---
test.each([
  ["Enter", "Enter", {}, "insertLineBreak"],
  ["Backspace", "Backspace", {}, "deleteBackward"],
  ["Delete", "Delete", {}, "deleteForward"],
  ["Home", "Home", {}, "moveToLineStart"],
  ["End", "End", {}, "moveToLineEnd"],
  ["Tab", "Tab", {}, "indent"],
  ["Shift+Tab", "Tab", { shiftKey: true }, "dedent"],
  ["meta+ArrowLeft", "ArrowLeft", { metaKey: true }, "moveToLineStart"],
  ["meta+ArrowRight", "ArrowRight", { metaKey: true }, "moveToLineEnd"],
  ["meta+shift+ArrowLeft", "ArrowLeft", { metaKey: true, shiftKey: true }, "moveToLineStart"],
  ["meta+shift+ArrowRight", "ArrowRight", { metaKey: true, shiftKey: true }, "moveToLineEnd"],
  ["alt+ArrowLeft", "ArrowLeft", { altKey: true }, "moveWordBackward"],
  ["alt+shift+ArrowRight", "ArrowRight", { altKey: true, shiftKey: true }, "moveWordForward"],
  ["meta+Home", "Home", { metaKey: true }, "moveToDocumentStart"],
  ["ctrl+shift+End", "End", { ctrlKey: true, shiftKey: true }, "moveToDocumentEnd"],
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

test.each([
  ["mac backward", "Backspace", { altKey: true }, "mac", "deleteWordBackward"],
  ["mac forward", "Delete", { altKey: true }, "mac", "deleteWordForward"],
  ["non-Mac backward", "Backspace", { ctrlKey: true }, "nonMac", "deleteWordBackward"],
  ["non-Mac forward", "Delete", { ctrlKey: true }, "nonMac", "deleteWordForward"],
] as const)(
  "resolves platform word deletion for %s",
  (_label, key, modifiers, platform, command) => {
    expect(
      resolveEditorInputCommand(createKeyboardEvent(key, modifiers), undefined, platform),
    ).toBe(command);
  },
);

test.each([
  ["Mac Ctrl+Backspace", "Backspace", { ctrlKey: true }, "mac"],
  ["non-Mac Alt+Backspace", "Backspace", { altKey: true }, "nonMac"],
  ["Ctrl+Meta+Backspace", "Backspace", { ctrlKey: true, metaKey: true }, "nonMac"],
  ["Shift+Delete", "Delete", { shiftKey: true }, "nonMac"],
] as const)(
  "does not hijack unsupported modified deletion for %s",
  (_label, key, modifiers, platform) => {
    expect(
      resolveEditorInputCommand(createKeyboardEvent(key, modifiers), undefined, platform),
    ).toBeNull();
  },
);

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
