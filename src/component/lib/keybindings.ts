import type { EditorInputCommand } from "@/types";
import { resolveEditorHostPlatform, type EditorHostPlatform } from "./platform";

export type EditorInputKeybinding = {
  altKey?: boolean;
  command: EditorInputCommand;
  key: string;
  modKey?: boolean;
  platform?: "mac" | "nonMac";
  shiftKey?: boolean | "any";
};

export const defaultKeybindings: readonly EditorInputKeybinding[] = [
  { key: "Backspace", command: "deleteBackward" },
  { key: "Delete", command: "deleteForward" },
  { key: "Enter", shiftKey: true, command: "insertSoftLineBreak" },
  { key: "Enter", command: "insertLineBreak" },
  { key: "Home", platform: "nonMac", shiftKey: "any", command: "moveToLineStart" },
  { key: "End", platform: "nonMac", shiftKey: "any", command: "moveToLineEnd" },
  { key: "Tab", command: "indent" },
  { key: "Tab", shiftKey: true, command: "dedent" },
  {
    key: "ArrowLeft",
    altKey: true,
    platform: "mac",
    shiftKey: "any",
    command: "moveWordBackward",
  },
  {
    key: "ArrowRight",
    altKey: true,
    platform: "mac",
    shiftKey: "any",
    command: "moveWordForward",
  },
  {
    key: "ArrowLeft",
    modKey: true,
    platform: "mac",
    shiftKey: "any",
    command: "moveToLineStart",
  },
  {
    key: "ArrowRight",
    modKey: true,
    platform: "mac",
    shiftKey: "any",
    command: "moveToLineEnd",
  },
  {
    key: "ArrowUp",
    modKey: true,
    platform: "mac",
    shiftKey: "any",
    command: "moveToDocumentStart",
  },
  {
    key: "ArrowDown",
    modKey: true,
    platform: "mac",
    shiftKey: "any",
    command: "moveToDocumentEnd",
  },
  {
    key: "ArrowLeft",
    modKey: true,
    platform: "nonMac",
    shiftKey: "any",
    command: "moveWordBackward",
  },
  {
    key: "ArrowRight",
    modKey: true,
    platform: "nonMac",
    shiftKey: "any",
    command: "moveWordForward",
  },
  {
    key: "Home",
    modKey: true,
    platform: "nonMac",
    shiftKey: "any",
    command: "moveToDocumentStart",
  },
  {
    key: "End",
    modKey: true,
    platform: "nonMac",
    shiftKey: "any",
    command: "moveToDocumentEnd",
  },
  { key: "ArrowUp", altKey: true, shiftKey: true, command: "moveListItemUp" },
  { key: "ArrowDown", altKey: true, shiftKey: true, command: "moveListItemDown" },
  { key: "Backspace", altKey: true, platform: "mac", command: "deleteWordBackward" },
  { key: "Delete", altKey: true, platform: "mac", command: "deleteWordForward" },
  { key: "Backspace", modKey: true, platform: "nonMac", command: "deleteWordBackward" },
  { key: "Delete", modKey: true, platform: "nonMac", command: "deleteWordForward" },
  { key: "a", modKey: true, command: "selectAll" },
  { key: "b", modKey: true, command: "toggleBold" },
  { key: "e", modKey: true, command: "toggleCode" },
  { key: "i", modKey: true, command: "toggleItalic" },
  { key: ".", modKey: true, command: "toggleSuperscript" },
  { key: "u", modKey: true, command: "toggleUnderline" },
  { key: "x", modKey: true, shiftKey: true, command: "toggleStrikethrough" },
  { key: "y", modKey: true, command: "redo" },
  { key: "z", modKey: true, command: "undo" },
  { key: "z", modKey: true, shiftKey: true, command: "redo" },
];

export function resolveEditorInputCommand(
  event: KeyboardEvent,
  keybindings: readonly EditorInputKeybinding[] = defaultKeybindings,
  platform: EditorHostPlatform = resolveEditorHostPlatform(),
): EditorInputCommand | null {
  const keybindingPlatform = platform === "mac" ? "mac" : "nonMac";

  return (
    keybindings.find((binding) => {
      const shiftMatches =
        binding.shiftKey === "any"
          ? true
          : (binding.shiftKey ?? false) === (event.shiftKey ?? false);

      return (
        binding.key.toLowerCase() === event.key.toLowerCase() &&
        (binding.altKey ?? false) === (event.altKey ?? false) &&
        shiftMatches &&
        (binding.platform === undefined || binding.platform === keybindingPlatform) &&
        modifiersMatch(binding, event, platform)
      );
    })?.command ?? null
  );
}

function modifiersMatch(
  binding: EditorInputKeybinding,
  event: KeyboardEvent,
  platform: EditorHostPlatform,
) {
  // `mod` means exactly the platform's primary command key, not a mixed chord.
  const primaryKey = platform === "mac" ? event.metaKey : event.ctrlKey;
  const secondaryKey = platform === "mac" ? event.ctrlKey : event.metaKey;

  return (binding.modKey ?? false) === Boolean(primaryKey) && !secondaryKey;
}
