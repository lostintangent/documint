import type { EditorInputCommand } from "@/types";
import { resolveEditorPlatform, type EditorPlatform } from "./platform";

type EditorInputKeybindingBase = {
  altKey?: boolean;
  command: EditorInputCommand;
  key: string;
  platform?: EditorPlatform;
  shiftKey?: boolean | "any";
};

type ModKeybinding = {
  ctrlKey?: never;
  metaKey?: never;
  modKey?: boolean;
};

type ExactModifierKeybinding = {
  ctrlKey?: boolean;
  metaKey?: boolean;
  modKey?: never;
};

export type EditorInputKeybinding = EditorInputKeybindingBase &
  (ModKeybinding | ExactModifierKeybinding);

export const defaultKeybindings: EditorInputKeybinding[] = [
  { key: "Backspace", command: "deleteBackward" },
  { key: "Delete", command: "deleteForward" },
  { key: "Enter", shiftKey: true, command: "insertSoftLineBreak" },
  { key: "Enter", command: "insertLineBreak" },
  { key: "Home", command: "moveToLineStart" },
  { key: "End", command: "moveToLineEnd" },
  { key: "Tab", command: "indent" },
  { key: "Tab", shiftKey: true, command: "dedent" },
  { key: "ArrowLeft", altKey: true, shiftKey: "any", command: "moveWordBackward" },
  { key: "ArrowRight", altKey: true, shiftKey: "any", command: "moveWordForward" },
  { key: "ArrowLeft", modKey: true, shiftKey: "any", command: "moveToLineStart" },
  { key: "ArrowRight", modKey: true, shiftKey: "any", command: "moveToLineEnd" },
  { key: "ArrowUp", modKey: true, shiftKey: "any", command: "moveToDocumentStart" },
  { key: "ArrowDown", modKey: true, shiftKey: "any", command: "moveToDocumentEnd" },
  { key: "Home", modKey: true, shiftKey: "any", command: "moveToDocumentStart" },
  { key: "End", modKey: true, shiftKey: "any", command: "moveToDocumentEnd" },
  { key: "ArrowUp", altKey: true, shiftKey: true, command: "moveListItemUp" },
  { key: "ArrowDown", altKey: true, shiftKey: true, command: "moveListItemDown" },
  { key: "Backspace", altKey: true, platform: "mac", command: "deleteWordBackward" },
  { key: "Delete", altKey: true, platform: "mac", command: "deleteWordForward" },
  { key: "Backspace", ctrlKey: true, platform: "nonMac", command: "deleteWordBackward" },
  { key: "Delete", ctrlKey: true, platform: "nonMac", command: "deleteWordForward" },
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
  keybindings: EditorInputKeybinding[] = defaultKeybindings,
  platform: EditorPlatform = resolveEditorPlatform(),
): EditorInputCommand | null {
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
        (binding.platform === undefined || binding.platform === platform) &&
        modifiersMatch(binding, event)
      );
    })?.command ?? null
  );
}

function modifiersMatch(binding: EditorInputKeybinding, event: KeyboardEvent) {
  if (binding.modKey !== undefined) {
    return binding.modKey === Boolean(event.metaKey || event.ctrlKey);
  }

  return (
    (binding.ctrlKey ?? false) === (event.ctrlKey ?? false) &&
    (binding.metaKey ?? false) === (event.metaKey ?? false)
  );
}
