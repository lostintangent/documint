import type { EditorInputCommand } from "@/types";
import { resolveEditorHostPlatform, type EditorHostPlatform } from "./platform";

export type EditorKeybindingPlatform = "mac" | "nonMac";

type EditorInputKeybindingBase = {
  altKey?: boolean;
  command: EditorInputCommand;
  key: string;
  platform?: EditorKeybindingPlatform;
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
    metaKey: true,
    platform: "mac",
    shiftKey: "any",
    command: "moveToLineStart",
  },
  {
    key: "ArrowRight",
    metaKey: true,
    platform: "mac",
    shiftKey: "any",
    command: "moveToLineEnd",
  },
  {
    key: "ArrowUp",
    metaKey: true,
    platform: "mac",
    shiftKey: "any",
    command: "moveToDocumentStart",
  },
  {
    key: "ArrowDown",
    metaKey: true,
    platform: "mac",
    shiftKey: "any",
    command: "moveToDocumentEnd",
  },
  {
    key: "ArrowLeft",
    ctrlKey: true,
    platform: "nonMac",
    shiftKey: "any",
    command: "moveWordBackward",
  },
  {
    key: "ArrowRight",
    ctrlKey: true,
    platform: "nonMac",
    shiftKey: "any",
    command: "moveWordForward",
  },
  {
    key: "Home",
    ctrlKey: true,
    platform: "nonMac",
    shiftKey: "any",
    command: "moveToDocumentStart",
  },
  {
    key: "End",
    ctrlKey: true,
    platform: "nonMac",
    shiftKey: "any",
    command: "moveToDocumentEnd",
  },
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
  platform: EditorHostPlatform = resolveEditorHostPlatform(),
): EditorInputCommand | null {
  const keybindingPlatform = resolveKeybindingPlatform(platform);

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
  if (binding.modKey !== undefined) {
    const primaryKey = platform === "mac" ? event.metaKey : event.ctrlKey;
    const secondaryKey = platform === "mac" ? event.ctrlKey : event.metaKey;

    return binding.modKey === Boolean(primaryKey) && !secondaryKey;
  }

  return (
    (binding.ctrlKey ?? false) === (event.ctrlKey ?? false) &&
    (binding.metaKey ?? false) === (event.metaKey ?? false)
  );
}

function resolveKeybindingPlatform(platform: EditorHostPlatform): EditorKeybindingPlatform {
  return platform === "mac" ? "mac" : "nonMac";
}
