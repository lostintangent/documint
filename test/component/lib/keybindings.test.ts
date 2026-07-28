import { describe, expect, test } from "bun:test";
import {
  defaultKeybindings,
  resolveEditorInputCommand,
  type EditorInputKeybinding,
} from "@/component/lib/keybindings";
import type { EditorHostPlatform } from "@/component/lib/platform";

describe("Default keybindings", () => {
  test.each([
    ["Enter", "Enter", {}, "insertLineBreak"],
    ["Shift+Enter", "Enter", { shiftKey: true }, "insertSoftLineBreak"],
    ["Backspace", "Backspace", {}, "deleteBackward"],
    ["Delete", "Delete", {}, "deleteForward"],
    ["Tab", "Tab", {}, "indent"],
    ["Shift+Tab", "Tab", { shiftKey: true }, "dedent"],
    ["Alt+Shift+ArrowUp", "ArrowUp", { altKey: true, shiftKey: true }, "moveListItemUp"],
    ["Alt+Shift+ArrowDown", "ArrowDown", { altKey: true, shiftKey: true }, "moveListItemDown"],
  ] as const)("resolves the platform-independent key %s", (_label, key, modifiers, command) => {
    expect(resolve(key, modifiers, "windows")).toBe(command);
  });

  test.each([
    ["Option+Left", "ArrowLeft", { altKey: true }, "moveWordBackward"],
    ["Option+Shift+Right", "ArrowRight", { altKey: true, shiftKey: true }, "moveWordForward"],
    ["Command+Left", "ArrowLeft", { metaKey: true }, "moveToLineStart"],
    ["Command+Shift+Right", "ArrowRight", { metaKey: true, shiftKey: true }, "moveToLineEnd"],
    ["Command+Up", "ArrowUp", { metaKey: true }, "moveToDocumentStart"],
    ["Command+Shift+Down", "ArrowDown", { metaKey: true, shiftKey: true }, "moveToDocumentEnd"],
    ["Option+Backspace", "Backspace", { altKey: true }, "deleteWordBackward"],
    ["Option+Delete", "Delete", { altKey: true }, "deleteWordForward"],
  ] as const)("resolves the macOS key %s", (_label, key, modifiers, command) => {
    expect(resolve(key, modifiers, "mac")).toBe(command);
  });

  test.each([
    ["Control+Left", "ArrowLeft", { ctrlKey: true }, "moveWordBackward"],
    ["Control+Shift+Right", "ArrowRight", { ctrlKey: true, shiftKey: true }, "moveWordForward"],
    ["Home", "Home", {}, "moveToLineStart"],
    ["End", "End", {}, "moveToLineEnd"],
    ["Shift+Home", "Home", { shiftKey: true }, "moveToLineStart"],
    ["Shift+End", "End", { shiftKey: true }, "moveToLineEnd"],
    ["Control+Home", "Home", { ctrlKey: true }, "moveToDocumentStart"],
    ["Control+Shift+End", "End", { ctrlKey: true, shiftKey: true }, "moveToDocumentEnd"],
    ["Control+Backspace", "Backspace", { ctrlKey: true }, "deleteWordBackward"],
    ["Control+Delete", "Delete", { ctrlKey: true }, "deleteWordForward"],
  ] as const)("resolves the non-Mac key %s", (_label, key, modifiers, command) => {
    expect(resolve(key, modifiers, "windows")).toBe(command);
  });

  test("uses the same non-Mac bindings on other hosts", () => {
    expect(resolve("ArrowLeft", { ctrlKey: true }, "other")).toBe("moveWordBackward");
    expect(resolve("Delete", { ctrlKey: true }, "other")).toBe("deleteWordForward");
    expect(resolve("Home", {}, "other")).toBe("moveToLineStart");
  });

  test.each([
    ["macOS Command+B", "b", { metaKey: true }, "mac", "toggleBold"],
    ["macOS Command+E", "e", { metaKey: true }, "mac", "toggleCode"],
    ["macOS Command+I", "i", { metaKey: true }, "mac", "toggleItalic"],
    ["macOS Command+Period", ".", { metaKey: true }, "mac", "toggleSuperscript"],
    ["macOS Command+U", "u", { metaKey: true }, "mac", "toggleUnderline"],
    ["macOS Command+Shift+X", "x", { metaKey: true, shiftKey: true }, "mac", "toggleStrikethrough"],
    ["macOS Command+Z", "z", { metaKey: true }, "mac", "undo"],
    ["macOS Command+Shift+Z", "z", { metaKey: true, shiftKey: true }, "mac", "redo"],
    ["non-Mac Control+B", "b", { ctrlKey: true }, "windows", "toggleBold"],
    ["non-Mac Control+Y", "y", { ctrlKey: true }, "other", "redo"],
    ["non-Mac Control+Shift+Z", "z", { ctrlKey: true, shiftKey: true }, "other", "redo"],
    ["non-Mac Control+A", "a", { ctrlKey: true }, "windows", "selectAll"],
  ] as const)(
    "resolves the primary-modifier shortcut %s",
    (_label, key, modifiers, platform, command) => {
      expect(resolve(key, modifiers, platform)).toBe(command);
    },
  );

  test.each([
    ["macOS Control+Left", "ArrowLeft", { ctrlKey: true }, "mac"],
    ["macOS Home", "Home", {}, "mac"],
    ["macOS Shift+End", "End", { shiftKey: true }, "mac"],
    ["macOS Command+Home", "Home", { metaKey: true }, "mac"],
    ["macOS Control+B", "b", { ctrlKey: true }, "mac"],
    ["non-Mac Alt+Left", "ArrowLeft", { altKey: true }, "windows"],
    ["non-Mac Meta+Left", "ArrowLeft", { metaKey: true }, "windows"],
    ["non-Mac Control+Up", "ArrowUp", { ctrlKey: true }, "other"],
    ["non-Mac Meta+B", "b", { metaKey: true }, "other"],
    ["Control+Meta+Backspace", "Backspace", { ctrlKey: true, metaKey: true }, "windows"],
    ["Shift+Delete", "Delete", { shiftKey: true }, "windows"],
  ] as const)("does not hijack unsupported shortcut %s", (_label, key, modifiers, platform) => {
    expect(resolve(key, modifiers, platform)).toBeNull();
  });
});

describe("Custom keybindings", () => {
  test("uses the active platform modifier for modKey", () => {
    const keybindings: EditorInputKeybinding[] = [
      { command: "toggleBold", key: "k", modKey: true },
    ];

    expect(resolve("k", { metaKey: true }, "mac", keybindings)).toBe("toggleBold");
    expect(resolve("k", { ctrlKey: true }, "mac", keybindings)).toBeNull();
    expect(resolve("k", { ctrlKey: true }, "windows", keybindings)).toBe("toggleBold");
    expect(resolve("k", { ctrlKey: true }, "other", keybindings)).toBe("toggleBold");
    expect(resolve("k", { metaKey: true }, "windows", keybindings)).toBeNull();
    expect(resolve("k", { ctrlKey: true, metaKey: true }, "windows", keybindings)).toBeNull();
  });

  test("supports explicit unmodified bindings", () => {
    const unmodified: EditorInputKeybinding[] = [
      { command: "toggleBold", key: "k", modKey: false },
    ];

    expect(resolve("k", {}, "mac", unmodified)).toBe("toggleBold");
    expect(resolve("k", { metaKey: true }, "mac", unmodified)).toBeNull();
    expect(resolve("k", { ctrlKey: true }, "mac", unmodified)).toBeNull();
    expect(resolve("k", {}, "windows", unmodified)).toBe("toggleBold");
    expect(resolve("k", { ctrlKey: true }, "windows", unmodified)).toBeNull();
    expect(resolve("k", { metaKey: true }, "windows", unmodified)).toBeNull();
  });

  test("replaces rather than supplements the default keybinding set", () => {
    const keybindings: EditorInputKeybinding[] = [
      { command: "toggleBold", key: "k", modKey: true },
    ];

    expect(resolve("k", { metaKey: true }, "mac", keybindings)).toBe("toggleBold");
    expect(resolve("b", { metaKey: true }, "mac", keybindings)).toBeNull();
  });

  test("uses the first matching binding so callers can override defaults", () => {
    const keybindings: readonly EditorInputKeybinding[] = [
      { command: "toggleCode", key: "b", modKey: true },
      ...defaultKeybindings,
    ];

    expect(resolve("b", { metaKey: true }, "mac", keybindings)).toBe("toggleCode");
  });
});

function resolve(
  key: string,
  modifiers: KeyboardEventInit,
  platform: EditorHostPlatform,
  keybindings?: readonly EditorInputKeybinding[],
) {
  return resolveEditorInputCommand(createKeyboardEvent(key, modifiers), keybindings, platform);
}

function createKeyboardEvent(key: string, options: KeyboardEventInit = {}) {
  return {
    altKey: options.altKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    key,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
  } as KeyboardEvent;
}
