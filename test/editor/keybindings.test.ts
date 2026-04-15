import { expect, test } from "bun:test";
import { resolveEditorCommand, type EditorKeybinding } from "@/component/lib/keybindings";

test("maps modifier shortcuts to semantic editor commands", () => {
  expect(resolveEditorCommand(createKeyboardEvent("b", { metaKey: true }))).toBe("toggleSelectionBold");
  expect(resolveEditorCommand(createKeyboardEvent("i", { metaKey: true }))).toBe("toggleSelectionItalic");
  expect(resolveEditorCommand(createKeyboardEvent("u", { metaKey: true }))).toBe("toggleSelectionUnderline");
  expect(resolveEditorCommand(createKeyboardEvent("e", { metaKey: true }))).toBe("toggleSelectionInlineCode");
  expect(resolveEditorCommand(createKeyboardEvent("ArrowUp", { altKey: true, shiftKey: true }))).toBe(
    "moveListItemUp",
  );
  expect(resolveEditorCommand(createKeyboardEvent("ArrowDown", { altKey: true, shiftKey: true }))).toBe(
    "moveListItemDown",
  );
  expect(resolveEditorCommand(createKeyboardEvent("z", { metaKey: true }))).toBe("undo");
  expect(resolveEditorCommand(createKeyboardEvent("z", { metaKey: true, shiftKey: true }))).toBe("redo");
  expect(resolveEditorCommand(createKeyboardEvent("y", { ctrlKey: true }))).toBe("redo");
});

test("maps structural editor keys", () => {
  expect(resolveEditorCommand(createKeyboardEvent("Enter"))).toBe("insertLineBreak");
  expect(resolveEditorCommand(createKeyboardEvent("Backspace"))).toBe("deleteBackward");
  expect(resolveEditorCommand(createKeyboardEvent("Home"))).toBe("moveToLineStart");
  expect(resolveEditorCommand(createKeyboardEvent("End"))).toBe("moveToLineEnd");
  expect(resolveEditorCommand(createKeyboardEvent("Tab"))).toBe("indent");
  expect(resolveEditorCommand(createKeyboardEvent("Tab", { shiftKey: true }))).toBe("dedent");
  expect(resolveEditorCommand(createKeyboardEvent("ArrowLeft", { metaKey: true }))).toBe("moveToLineStart");
  expect(resolveEditorCommand(createKeyboardEvent("ArrowRight", { metaKey: true }))).toBe("moveToLineEnd");
  expect(resolveEditorCommand(createKeyboardEvent("ArrowLeft", { metaKey: true, shiftKey: true }))).toBe("moveToLineStart");
  expect(resolveEditorCommand(createKeyboardEvent("ArrowRight", { metaKey: true, shiftKey: true }))).toBe("moveToLineEnd");
});

test("ignores unsupported keyboard shortcuts", () => {
  expect(resolveEditorCommand(createKeyboardEvent("x", { metaKey: true }))).toBeNull();
  expect(resolveEditorCommand(createKeyboardEvent("b"))).toBeNull();
});

test("resolves commands against a caller-provided keybinding set", () => {
  const keybindings: EditorKeybinding[] = [
    {
      command: "toggleSelectionBold",
      key: "k",
      modKey: true,
    },
  ];

  expect(resolveEditorCommand(createKeyboardEvent("k", { metaKey: true }), keybindings)).toBe(
    "toggleSelectionBold",
  );
  expect(resolveEditorCommand(createKeyboardEvent("b", { metaKey: true }), keybindings)).toBeNull();
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
